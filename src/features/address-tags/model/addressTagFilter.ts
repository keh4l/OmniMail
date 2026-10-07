import type { AddressTagEntry, AddressTagSource, AddressTagSummary, AddressTagUpdate } from '../api/address-tag-api-client'

export type TagFilterState = 'include' | 'exclude'

export interface AddressTagFilters {
  query: string
  source: AddressTagSource | 'all'
  tags: Record<string, TagFilterState>
  untaggedOnly: boolean
}

export const SOURCE_ORDER: AddressTagSource[] = [
  'omnimail', 'icloud', 'icloud-hme', 'gmail', 'microsoft', 'qq', 'naver', 'yandex', 'linuxdo', 'other',
]

export const TAG_MAX_LENGTH = 32

export const emptyAddressTagFilters: AddressTagFilters = { query: '', source: 'all', tags: {}, untaggedOnly: false }

// 与 Worker 和 SQLite NOCASE 保持一致：只折叠 ASCII 大小写。
export function tagKey(tag: string): string {
  return tag.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

export function normalizeTagInput(value: string): string | null {
  const tag = value.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!tag || [...tag].length > TAG_MAX_LENGTH || /\p{Cc}/u.test(tag)) return null
  return tag
}

export function withTag(tags: string[], tag: string): string[] {
  return tags.some((current) => tagKey(current) === tagKey(tag)) ? tags : [...tags, tag]
}

export function withoutTag(tags: string[], tag: string): string[] {
  return tags.filter((current) => tagKey(current) !== tagKey(tag))
}

// 点击标签：未选中时按当前模式加入；与当前模式相同则取消；不同则切换到当前模式。
export function toggleTagFilter(filters: AddressTagFilters, tag: string, mode: TagFilterState): AddressTagFilters {
  const key = tagKey(tag)
  const rules = { ...filters.tags }
  if (rules[key] === mode) delete rules[key]
  else rules[key] = mode
  return { ...filters, tags: rules }
}

export function withoutTagFilter(filters: AddressTagFilters, tag: string): AddressTagFilters {
  const rules = { ...filters.tags }
  delete rules[tagKey(tag)]
  return { ...filters, tags: rules }
}

export function hasActiveFilters(filters: AddressTagFilters): boolean {
  return Boolean(filters.query.trim()) || filters.source !== 'all' || filters.untaggedOnly
    || Object.keys(filters.tags).length > 0
}

// 包含条件需要全部满足，排除条件命中任意一个即隐藏，用于找出"还没注册过某网站"的地址。
export function filterAddressEntries(entries: AddressTagEntry[], filters: AddressTagFilters): AddressTagEntry[] {
  const query = filters.query.trim().toLowerCase()
  const rules = Object.entries(filters.tags).map(([tag, state]) => [tagKey(tag), state] as const)
  return entries.filter((entry) => {
    if (query && !entry.address.includes(query)) return false
    if (filters.source !== 'all' && !entry.sources.includes(filters.source)) return false
    if (filters.untaggedOnly && entry.tags.length) return false
    const keys = new Set(entry.tags.map(tagKey))
    return rules.every(([key, state]) => (state === 'include') === keys.has(key))
  })
}

export function mergeHideMyEmailAliases(entries: AddressTagEntry[], aliases: string[]): AddressTagEntry[] {
  if (!aliases.length) return entries
  const merged = new Map(entries.map((entry) => [entry.address, entry]))
  for (const raw of aliases) {
    const address = raw.trim().toLowerCase()
    if (!address) continue
    const current = merged.get(address)
    const sources = (current?.sources ?? []).filter((source) => source !== 'other')
    merged.set(address, {
      ...current,
      address,
      tags: current?.tags ?? [],
      sources: sources.includes('icloud-hme') ? sources : sortSources([...sources, 'icloud-hme']),
    })
  }
  return [...merged.values()].sort((left, right) => left.address.localeCompare(right.address))
}

/** 带有标签、但已不在任何邮箱来源里的地址（例如账号已删除）：只能移除标签，不能再添加。 */
export function isStaleEntry(entry: AddressTagEntry): boolean {
  return entry.sources.includes('other')
}

export function applyAddressTagUpdates(entries: AddressTagEntry[], updates: AddressTagUpdate[]): AddressTagEntry[] {
  const changes = new Map(updates.map((update) => [update.address, update.tags]))
  return entries.flatMap((entry) => {
    if (!changes.has(entry.address)) return [entry]
    const tags = changes.get(entry.address) ?? []
    // 已不在邮箱里的地址清空标签后，服务端也不会再返回它，直接从列表移除。
    return isStaleEntry(entry) && !tags.length ? [] : [{ ...entry, tags }]
  })
}

export function tagSummaries(entries: AddressTagEntry[]): AddressTagSummary[] {
  const summaries = new Map<string, AddressTagSummary>()
  for (const tag of entries.flatMap((entry) => entry.tags)) {
    const summary = summaries.get(tagKey(tag))
    if (summary) summary.count += 1
    else summaries.set(tagKey(tag), { name: tag, count: 1 })
  }
  return [...summaries.values()].sort(compareTagSummaries)
}

// 常用标签排在前面；同样次数按码点排序，避免不同运行环境的区域排序规则产生差异。
export function compareTagSummaries(left: AddressTagSummary, right: AddressTagSummary): number {
  if (left.count !== right.count) return right.count - left.count
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

export function sourceCounts(entries: AddressTagEntry[]): Array<[AddressTagSource, number]> {
  const counts = new Map<AddressTagSource, number>()
  for (const source of entries.flatMap((entry) => entry.sources)) counts.set(source, (counts.get(source) ?? 0) + 1)
  return SOURCE_ORDER.filter((source) => counts.has(source)).map((source) => [source, counts.get(source) ?? 0])
}

export interface AddressGroup {
  source: AddressTagSource
  entries: AddressTagEntry[]
}

// 按主来源分组（来源已按固定顺序排列，第一个即主来源），组的顺序与 SOURCE_ORDER 一致。
export function groupEntriesBySource(entries: AddressTagEntry[]): AddressGroup[] {
  const groups = new Map<AddressTagSource, AddressTagEntry[]>()
  for (const entry of entries) {
    const source = entry.sources[0] ?? 'other'
    groups.set(source, [...(groups.get(source) ?? []), entry])
  }
  return SOURCE_ORDER.filter((source) => groups.has(source)).map((source) => ({ source, entries: groups.get(source) ?? [] }))
}

function sortSources(sources: AddressTagSource[]): AddressTagSource[] {
  return [...sources].sort((left, right) => SOURCE_ORDER.indexOf(left) - SOURCE_ORDER.indexOf(right))
}
