import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  batchAddressTags,
  deleteAddressTag,
  listAddressTags,
  renameAddressTag,
  replaceAddressTags,
} from './address-tag-api'
import {
  AddressTagError,
  AddressTagStore,
  normalizeAddressList,
  normalizeTag,
  normalizeTagList,
} from './address-tag-store'
import type { Env, SessionUser } from '../../app/types'

type Row = Record<string, string | number | null>

// 在 node:sqlite 上执行全部真实迁移并模拟 D1 接口，让查询直接覆盖当前上游表结构。
function migratedDatabase(options: { skip?: string } = {}): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const names = readdirSync('migrations').filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
  for (const name of names) if (name !== options.skip) db.exec(readFileSync(`migrations/${name}`, 'utf8'))
  return db
}

function d1(db: DatabaseSync) {
  const statement = (sql: string, params: Array<string | number | null> = []) => ({
    sql,
    params,
    bind: (...values: Array<string | number | null>) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<ReturnType<typeof statement>>) {
      db.exec('BEGIN')
      try {
        const results = statements.map(({ sql, params }) => ({ results: db.prepare(sql).all(...params) }))
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

// 按表结构自动补齐必填列，测试只需声明与地址来源相关的字段。
function insert(db: DatabaseSync, table: string, values: Row): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null; pk: number
  }>
  const row: Row = { ...values }
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue
    row[column.name] = /INT/i.test(column.type) ? 0 : `${column.name}-${crypto.randomUUID()}`
  }
  const names = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((name) => row[name]))
}

function setup(options: { skip?: string } = {}) {
  const db = migratedDatabase(options)
  for (const id of ['owner', 'other']) insert(db, 'users', { id, email: `${id}@example.com` })
  const env = { DB: d1(db) } as unknown as Env
  return { db, env, store: new AddressTagStore(env, 'owner'), otherStore: new AddressTagStore(env, 'other') }
}

describe('address tag validation', () => {
  it('normalizes whitespace, Unicode form and duplicate casing', () => {
    expect(normalizeTag('  网站\n  A ')).toBe('网站 A')
    expect(normalizeTag('Café')).toBe('Café')
    expect(normalizeTagList(['GitHub', 'github', ' 网站A '])).toEqual(['GitHub', '网站A'])
    expect(normalizeAddressList(['A@Example.com', 'a@example.com'])).toEqual(['a@example.com'])
  })

  it('rejects invalid tags, oversized lists and invalid addresses', () => {
    expect(() => normalizeTag('')).toThrow(AddressTagError)
    expect(() => normalizeTag('x'.repeat(33))).toThrow('标签需要为 1–32 个字符')
    expect(() => normalizeTag('bad\u0000tag')).toThrow(AddressTagError)
    expect(() => normalizeTagList(Array.from({ length: 21 }, (_, index) => `t${index}`))).toThrow('每个地址最多 20 个标签')
    expect(() => normalizeTagList('网站A')).toThrow('标签列表格式无效')
    expect(() => normalizeAddressList([])).toThrow('地址列表需要包含 1–200 个邮箱地址')
    expect(() => normalizeAddressList(['not-an-email'])).toThrow('请填写有效的邮箱地址')
  })
})

describe('AddressTagStore', () => {
  it('lists addresses from every stored source and keeps users isolated', async () => {
    const { db, store } = setup()
    insert(db, 'mailboxes', { address: 'active@mine.test', user_id: 'owner', is_active: 1 })
    insert(db, 'mailboxes', { address: 'paused@mine.test', user_id: 'owner', is_active: 0 })
    insert(db, 'mailboxes', { address: 'hidden@mine.test', user_id: 'owner', is_hidden: 1 })
    insert(db, 'mailboxes', { address: 'theirs@mine.test', user_id: 'other' })
    insert(db, 'icloud_accounts', { id: 'icloud', user_id: 'owner', icloud_email: 'me@icloud.com' })
    insert(db, 'gmail_imap_accounts', { id: 'gmail', user_id: 'owner', email: 'me@gmail.com' })
    insert(db, 'microsoft_imap_accounts', {
      id: 'ms', user_id: 'owner', provided_email: 'Me@Outlook.com', normalized_email: 'me@outlook.com', auth_mode: 'password',
      client_id: '', refresh_token_cipher: '', password_cipher: 'cipher',
    })
    insert(db, 'qq_mail_accounts', { id: 'qq', user_id: 'owner', email: 'me@qq.com' })
    insert(db, 'qq_mail_identities', { id: 'qq-id', account_id: 'qq', email: 'alias@foxmail.com' })
    insert(db, 'naver_mail_accounts', { id: 'naver', user_id: 'owner', email: 'me@naver.com' })
    insert(db, 'yandex_mail_accounts', { id: 'yandex', user_id: 'owner', email: 'me@yandex.com' })
    insert(db, 'linux_do_mail_accounts', { id: 'linuxdo', user_id: 'owner', username: 'me@linux.do' })
    await store.replace('me@gmail.com', ['网站A'])
    await store.replace('gone@old.test', ['网站A', '网站B'])

    const { addresses, tags } = await store.list()
    const sources = Object.fromEntries(addresses.map((entry) => [entry.address, entry.sources]))
    expect(sources).toEqual({
      'active@mine.test': ['omnimail'],
      'alias@foxmail.com': ['qq'],
      'gone@old.test': ['other'],
      'me@gmail.com': ['gmail'],
      'me@icloud.com': ['icloud'],
      'me@linux.do': ['linuxdo'],
      'me@naver.com': ['naver'],
      'me@outlook.com': ['microsoft'],
      'me@qq.com': ['qq'],
      'me@yandex.com': ['yandex'],
      'paused@mine.test': ['omnimail'],
    })
    expect(addresses.find((entry) => entry.address === 'paused@mine.test')?.isActive).toBe(false)
    expect(addresses.find((entry) => entry.address === 'me@gmail.com')).not.toHaveProperty('isActive')
    expect(tags).toEqual([{ name: '网站A', count: 2 }, { name: '网站B', count: 1 }])
    expect(await new AddressTagStore({ DB: d1(db) } as unknown as Env, 'other').list()).toEqual({
      addresses: [{ address: 'theirs@mine.test', sources: ['omnimail'], isActive: true, tags: [] }],
      tags: [],
    })
  })

  it('replaces tags in order while reusing the existing spelling of a tag', async () => {
    const { store } = setup()
    expect(await store.replace('a@mine.test', ['GitHub', '网站A'])).toEqual(['GitHub', '网站A'])
    expect(await store.replace('b@mine.test', ['github', 'X'])).toEqual(['GitHub', 'X'])
    expect(await store.replace('a@mine.test', ['网站A', '网站C'])).toEqual(['网站A', '网站C'])
    expect(await store.replace('a@mine.test', [])).toEqual([])
    expect((await store.list()).tags).toEqual([{ name: 'GitHub', count: 1 }, { name: 'X', count: 1 }])
  })

  it('adds and removes tags in bulk with per-address limits', async () => {
    const { store } = setup()
    await store.replace('a@mine.test', ['旧标签'])
    expect(await store.batch(['a@mine.test', 'b@mine.test'], ['网站A'], ['旧标签'])).toEqual([
      { address: 'a@mine.test', tags: ['网站A'] },
      { address: 'b@mine.test', tags: ['网站A'] },
    ])
    await expect(store.batch(['a@mine.test'], ['网站A'], ['网站A'])).rejects.toThrow('同一个标签不能同时添加和移除')
    await expect(store.batch(['a@mine.test'], [], [])).rejects.toThrow('请至少指定一个要添加或移除的标签')
    await store.replace('full@mine.test', Array.from({ length: 20 }, (_, index) => `t${index}`))
    await expect(store.batch(['full@mine.test'], ['再多一个'], [])).rejects.toMatchObject({ status: 409 })
  })

  it('renames, merges and deletes tags only for the current user', async () => {
    const { store, otherStore } = setup()
    await store.replace('a@mine.test', ['网站A'])
    await store.replace('b@mine.test', ['网站A', 'GitHub'])
    await store.replace('c@mine.test', ['github'])
    await otherStore.replace('x@theirs.test', ['网站A'])

    expect(await store.rename('网站A', 'github')).toEqual({ name: 'GitHub', count: 3 })
    expect(await store.rename('GITHUB', 'GitHub-Site')).toEqual({ name: 'GitHub-Site', count: 3 })
    await expect(store.rename('不存在', 'x')).rejects.toMatchObject({ status: 404 })
    await store.remove('github-site')
    await expect(store.remove('github-site')).rejects.toMatchObject({ status: 404 })
    expect((await store.list()).tags).toEqual([])
    expect((await otherStore.list()).tags).toEqual([{ name: '网站A', count: 1 }])
  })

  it('caps the number of distinct tags per user', async () => {
    const { db, store } = setup()
    const insertTag = db.prepare('INSERT INTO address_tags (user_id, address, tag) VALUES (?, ?, ?)')
    for (let index = 0; index < 300; index += 1) insertTag.run('owner', 'bulk@mine.test', `t${index}`)
    await expect(store.replace('new@mine.test', ['t1'])).resolves.toEqual(['t1'])
    await expect(store.replace('new@mine.test', ['全新标签'])).rejects.toThrow('标签总数不能超过 300 个')
  })

  it('reports a pending migration when the table is missing', async () => {
    const { store } = setup({ skip: '9001_address_tags.sql' })
    await expect(store.list()).rejects.toMatchObject({
      status: 503,
      message: '地址标签数据库迁移未完成，请运行 npm run deploy。',
    })
  })
})

describe('address tag API', () => {
  const owner = { id: 'owner', role: 'temporary' } as SessionUser
  const request = (body: unknown) => new Request('https://mail.example/api/address-tags', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  it('serves private responses for every write and read', async () => {
    const { env } = setup()
    const replaced = await replaceAddressTags(env, owner, 'Me@Example.com', request({ tags: ['网站A'] }))
    expect(replaced.status).toBe(200)
    expect(replaced.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await replaced.json()).toEqual({ address: 'me@example.com', tags: ['网站A'] })

    const batch = await batchAddressTags(env, owner, request({ addresses: ['me@example.com'], add: ['网站B'] }))
    expect(await batch.json()).toEqual({ addresses: [{ address: 'me@example.com', tags: ['网站A', '网站B'] }] })

    const renamed = await renameAddressTag(env, owner, '网站B', request({ name: '网站C' }))
    expect(await renamed.json()).toEqual({ tag: { name: '网站C', count: 1 } })
    expect((await deleteAddressTag(env, owner, '网站C')).status).toBe(200)

    const listed = await listAddressTags(env, owner)
    expect(listed.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await listed.json()).toEqual({
      addresses: [{ address: 'me@example.com', sources: ['other'], tags: ['网站A'] }],
      tags: [{ name: '网站A', count: 1 }],
    })
  })

  it('maps validation failures to JSON errors', async () => {
    const { env } = setup()
    const invalidJson = await replaceAddressTags(env, owner, 'me@example.com', request('{'))
    expect(invalidJson.status).toBe(400)
    expect(await invalidJson.json()).toEqual({ error: '请求体必须是 JSON 对象。' })
    expect((await replaceAddressTags(env, owner, 'nobody', request({ tags: [] }))).status).toBe(400)
    expect((await batchAddressTags(env, owner, request({ addresses: ['me@example.com'], add: 'x' }))).status).toBe(400)
    expect((await deleteAddressTag(env, owner, '不存在')).status).toBe(404)
  })

  it('leaves unexpected database failures to the global error handler', async () => {
    const statement = { bind: () => statement }
    const env = {
      DB: { prepare: () => statement, batch: async () => { throw new Error('D1 unavailable') } },
    } as unknown as Env
    await expect(listAddressTags(env, owner)).rejects.toThrow('D1 unavailable')
  })
})
