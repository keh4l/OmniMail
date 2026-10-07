import { normalizeEmail, validEmail } from '../../shared/http/api-helpers'
import type { Env } from '../../app/types'

export const ADDRESS_TAG_SOURCES = [
  'omnimail', 'icloud', 'gmail', 'microsoft', 'qq', 'naver', 'yandex', 'linuxdo', 'other',
] as const
export type AddressTagSource = typeof ADDRESS_TAG_SOURCES[number]

export const TAG_MAX_LENGTH = 32
export const TAGS_PER_ADDRESS = 20
export const DISTINCT_TAGS_PER_USER = 300
export const TAG_ROWS_PER_USER = 10_000
export const BATCH_ADDRESS_LIMIT = 200
const RAW_LIST_LIMIT = 100

export interface AddressTagEntry {
  address: string
  sources: AddressTagSource[]
  isActive?: boolean
  tags: string[]
}

export interface AddressTagSummary {
  name: string
  count: number
}

export class AddressTagError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'AddressTagError'
  }
}

interface SourceRow { address: string; is_active?: number }
interface TagRow { address: string; tag: string }

// 每个来源都按 user_id 限定；地址只读取已保存在 D1 的账号，不访问外部邮箱服务。
// D1 限制复合 SELECT 的项数，因此各来源作为同一批次中的独立语句执行。
const SOURCE_QUERIES: Array<[AddressTagSource, string]> = [
  ['omnimail', 'SELECT address, is_active FROM mailboxes WHERE user_id = ? AND is_hidden = 0'],
  ['icloud', "SELECT icloud_email AS address FROM icloud_accounts WHERE user_id = ? AND icloud_email <> ''"],
  ['gmail', 'SELECT email AS address FROM gmail_imap_accounts WHERE user_id = ?'],
  ['microsoft', 'SELECT normalized_email AS address FROM microsoft_imap_accounts WHERE user_id = ?'],
  ['qq', 'SELECT email AS address FROM qq_mail_accounts WHERE user_id = ?'],
  ['qq', `SELECT qi.email AS address FROM qq_mail_identities qi
     JOIN qq_mail_accounts qa ON qa.id = qi.account_id WHERE qa.user_id = ?`],
  ['naver', 'SELECT email AS address FROM naver_mail_accounts WHERE user_id = ?'],
  ['yandex', 'SELECT email AS address FROM yandex_mail_accounts WHERE user_id = ?'],
  ['linuxdo', 'SELECT username AS address FROM linux_do_mail_accounts WHERE user_id = ?'],
]

// 与 SQLite NOCASE 一致只折叠 ASCII 大小写，保证应用层去重和主键约束判断相同。
export function tagKey(tag: string): string {
  return tag.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

export function normalizeTag(value: unknown): string {
  const tag = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  if (!tag || [...tag].length > TAG_MAX_LENGTH || /\p{Cc}/u.test(tag)) {
    throw new AddressTagError(400, '标签需要为 1–32 个字符，且不能包含控制字符。')
  }
  return tag
}

export function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > RAW_LIST_LIMIT) {
    throw new AddressTagError(400, '标签列表格式无效。')
  }
  const tags = new Map<string, string>()
  for (const item of value) {
    const tag = normalizeTag(item)
    if (!tags.has(tagKey(tag))) tags.set(tagKey(tag), tag)
  }
  if (tags.size > TAGS_PER_ADDRESS) throw new AddressTagError(400, '每个地址最多 20 个标签。')
  return [...tags.values()]
}

export function normalizeTagAddress(value: unknown): string {
  const address = typeof value === 'string' ? normalizeEmail(value) : ''
  if (!validEmail(address) || /\p{Cc}/u.test(address)) {
    throw new AddressTagError(400, '请填写有效的邮箱地址。')
  }
  return address
}

export function normalizeAddressList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > BATCH_ADDRESS_LIMIT) {
    throw new AddressTagError(400, '地址列表需要包含 1–200 个邮箱地址。')
  }
  return [...new Set(value.map(normalizeTagAddress))]
}

function sourceOrder(source: AddressTagSource): number {
  return ADDRESS_TAG_SOURCES.indexOf(source)
}

export class AddressTagStore {
  constructor(private readonly env: Env, private readonly userId: string) {}

  async list(): Promise<{ addresses: AddressTagEntry[]; tags: AddressTagSummary[] }> {
    const [tagResult, ...sourceResults] = await this.run(() => this.env.DB.batch([
      this.env.DB.prepare(
        'SELECT address, tag FROM address_tags WHERE user_id = ? ORDER BY address, created_at, rowid',
      ).bind(this.userId),
      ...SOURCE_QUERIES.map(([, sql]) => this.env.DB.prepare(sql).bind(this.userId)),
    ]))
    const entries = new Map<string, { sources: Set<AddressTagSource>; isActive?: boolean; tags: string[] }>()
    const entry = (raw: string) => {
      const address = normalizeEmail(raw)
      const current = entries.get(address) ?? { sources: new Set(), tags: [] }
      entries.set(address, current)
      return current
    }
    SOURCE_QUERIES.forEach(([source], index) => {
      for (const row of (sourceResults[index]?.results ?? []) as SourceRow[]) {
        if (!row.address) continue
        const current = entry(row.address)
        current.sources.add(source)
        if (source === 'omnimail') current.isActive = Boolean(row.is_active)
      }
    })
    const summaries = new Map<string, AddressTagSummary>()
    for (const row of (tagResult.results ?? []) as TagRow[]) {
      entry(row.address).tags.push(row.tag)
      const summary = summaries.get(tagKey(row.tag))
      if (summary) summary.count += 1
      else summaries.set(tagKey(row.tag), { name: row.tag, count: 1 })
    }
    const addresses = [...entries].map(([address, current]): AddressTagEntry => ({
      address,
      sources: current.sources.size
        ? [...current.sources].sort((left, right) => sourceOrder(left) - sourceOrder(right))
        : ['other'],
      ...(current.isActive === undefined ? {} : { isActive: current.isActive }),
      tags: current.tags,
    })).sort((left, right) => left.address.localeCompare(right.address))
    // 常用标签在前；同样次数按码点排序，结果不依赖运行环境的区域排序规则。
    const tags = [...summaries.values()].sort((left, right) => (
      right.count - left.count || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    ))
    return { addresses, tags }
  }

  async replace(address: string, requested: string[]): Promise<string[]> {
    const [distinct, counts] = await this.run(() => this.env.DB.batch([
      this.distinctTagsStatement(),
      this.env.DB.prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN address = ? THEN 1 ELSE 0 END), 0) AS current
           FROM address_tags WHERE user_id = ?`,
      ).bind(address, this.userId),
    ]))
    const existing = this.tagNames(distinct.results as Array<{ tag: string }>)
    const tags = requested.map((tag) => existing.get(tagKey(tag)) ?? tag)
    this.assertDistinctLimit(existing, tags)
    const { total, current } = (counts.results?.[0] ?? { total: 0, current: 0 }) as { total: number; current: number }
    if (Number(total) - Number(current) + tags.length > TAG_ROWS_PER_USER) {
      throw new AddressTagError(409, '标签记录总数已达到上限。')
    }
    const list = JSON.stringify(tags)
    const results = await this.run(() => this.env.DB.batch([
      this.env.DB.prepare(
        `DELETE FROM address_tags
          WHERE user_id = ? AND address = ? AND tag NOT IN (SELECT value FROM json_each(?))`,
      ).bind(this.userId, address, list),
      this.env.DB.prepare(
        `INSERT OR IGNORE INTO address_tags (user_id, address, tag)
         SELECT ?, ?, value FROM json_each(?) ORDER BY key`,
      ).bind(this.userId, address, list),
      this.env.DB.prepare(
        'SELECT tag FROM address_tags WHERE user_id = ? AND address = ? ORDER BY created_at, rowid',
      ).bind(this.userId, address),
    ]))
    return ((results[2]?.results ?? []) as Array<{ tag: string }>).map(({ tag }) => tag)
  }

  async batch(addresses: string[], add: string[], remove: string[]): Promise<Array<{ address: string; tags: string[] }>> {
    if (!add.length && !remove.length) throw new AddressTagError(400, '请至少指定一个要添加或移除的标签。')
    const removeKeys = new Set(remove.map(tagKey))
    if (add.some((tag) => removeKeys.has(tagKey(tag)))) {
      throw new AddressTagError(400, '同一个标签不能同时添加和移除。')
    }
    const addressList = JSON.stringify(addresses)
    const [distinct, current, counts] = await this.run(() => this.env.DB.batch([
      this.distinctTagsStatement(),
      this.env.DB.prepare(
        `SELECT address, tag FROM address_tags
          WHERE user_id = ? AND address IN (SELECT value FROM json_each(?))`,
      ).bind(this.userId, addressList),
      this.env.DB.prepare('SELECT COUNT(*) AS total FROM address_tags WHERE user_id = ?').bind(this.userId),
    ]))
    const existing = this.tagNames(distinct.results as Array<{ tag: string }>)
    const added = add.map((tag) => existing.get(tagKey(tag)) ?? tag)
    this.assertDistinctLimit(existing, added)
    const byAddress = new Map(addresses.map((address) => [address, new Set<string>()]))
    for (const row of (current.results ?? []) as TagRow[]) byAddress.get(normalizeEmail(row.address))?.add(tagKey(row.tag))
    let delta = 0
    for (const keys of byAddress.values()) {
      const before = keys.size
      for (const key of removeKeys) keys.delete(key)
      for (const tag of added) keys.add(tagKey(tag))
      if (keys.size > TAGS_PER_ADDRESS) throw new AddressTagError(409, '有地址的标签数量将超过 20 个。')
      delta += keys.size - before
    }
    const total = Number((counts.results?.[0] as { total?: number } | undefined)?.total ?? 0)
    if (total + delta > TAG_ROWS_PER_USER) throw new AddressTagError(409, '标签记录总数已达到上限。')
    const statements: D1PreparedStatement[] = []
    if (remove.length) {
      statements.push(this.env.DB.prepare(
        `DELETE FROM address_tags
          WHERE user_id = ? AND address IN (SELECT value FROM json_each(?))
            AND tag IN (SELECT value FROM json_each(?))`,
      ).bind(this.userId, addressList, JSON.stringify(remove)))
    }
    if (added.length) {
      statements.push(this.env.DB.prepare(
        `INSERT OR IGNORE INTO address_tags (user_id, address, tag)
         SELECT ?, a.value, t.value FROM json_each(?) a CROSS JOIN json_each(?) t ORDER BY a.key, t.key`,
      ).bind(this.userId, addressList, JSON.stringify(added)))
    }
    statements.push(this.env.DB.prepare(
      `SELECT address, tag FROM address_tags
        WHERE user_id = ? AND address IN (SELECT value FROM json_each(?))
        ORDER BY address, created_at, rowid`,
    ).bind(this.userId, addressList))
    const results = await this.run(() => this.env.DB.batch(statements))
    const tags = new Map(addresses.map((address) => [address, [] as string[]]))
    for (const row of (results[results.length - 1]?.results ?? []) as TagRow[]) tags.get(normalizeEmail(row.address))?.push(row.tag)
    return [...tags].map(([address, list]) => ({ address, tags: list }))
  }

  async rename(from: string, to: string): Promise<AddressTagSummary> {
    const [source, target] = await this.run(() => this.env.DB.batch([
      this.env.DB.prepare('SELECT COUNT(*) AS count FROM address_tags WHERE user_id = ? AND tag = ?').bind(this.userId, from),
      this.env.DB.prepare('SELECT tag FROM address_tags WHERE user_id = ? AND tag = ? LIMIT 1').bind(this.userId, to),
    ]))
    if (!Number((source.results?.[0] as { count?: number } | undefined)?.count)) {
      throw new AddressTagError(404, '标签不存在。')
    }
    const sameTag = tagKey(from) === tagKey(to)
    // 合并到已有标签时沿用其原有写法，避免同一标签在不同地址上出现大小写混用。
    const name = sameTag ? to : (target.results?.[0] as { tag?: string } | undefined)?.tag ?? to
    const statements = sameTag
      ? [this.env.DB.prepare('UPDATE address_tags SET tag = ? WHERE user_id = ? AND tag = ?').bind(name, this.userId, from)]
      : [
        this.env.DB.prepare(
          `INSERT OR IGNORE INTO address_tags (user_id, address, tag, created_at)
           SELECT user_id, address, ?, created_at FROM address_tags WHERE user_id = ? AND tag = ?`,
        ).bind(name, this.userId, from),
        this.env.DB.prepare('DELETE FROM address_tags WHERE user_id = ? AND tag = ?').bind(this.userId, from),
      ]
    statements.push(this.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM address_tags WHERE user_id = ? AND tag = ?',
    ).bind(this.userId, name))
    const results = await this.run(() => this.env.DB.batch(statements))
    const count = results[results.length - 1]?.results?.[0] as { count?: number } | undefined
    return { name, count: Number(count?.count ?? 0) }
  }

  async remove(tag: string): Promise<void> {
    const result = await this.run(() => this.env.DB.prepare(
      'DELETE FROM address_tags WHERE user_id = ? AND tag = ?',
    ).bind(this.userId, tag).run())
    if (!result.meta.changes) throw new AddressTagError(404, '标签不存在。')
  }

  private distinctTagsStatement(): D1PreparedStatement {
    return this.env.DB.prepare('SELECT DISTINCT tag FROM address_tags WHERE user_id = ?').bind(this.userId)
  }

  private tagNames(rows: Array<{ tag: string }> | undefined): Map<string, string> {
    return new Map((rows ?? []).map(({ tag }) => [tagKey(tag), tag]))
  }

  private assertDistinctLimit(existing: Map<string, string>, tags: string[]): void {
    const created = new Set(tags.map(tagKey).filter((key) => !existing.has(key)))
    if (existing.size + created.size > DISTINCT_TAGS_PER_USER) {
      throw new AddressTagError(409, '标签总数不能超过 300 个。')
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof Error && /no such table:\s*address_tags\b/i.test(error.message)) {
        throw new AddressTagError(503, '地址标签数据库迁移未完成，请运行 npm run deploy。')
      }
      throw error
    }
  }
}
