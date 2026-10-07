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

export function nextTagFilterState(current?: TagFilterState): TagFilterState | undefined {
  if (!current) return 'include'
  return current === 'include' ? 'exclude' : undefined
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

export function applyAddressTagUpdates(entries: AddressTagEntry[], updates: AddressTagUpdate[]): AddressTagEntry[] {
  const changes = new Map(updates.map((update) => [update.address, update.tags]))
  const next = entries.map((entry) => (changes.has(entry.address) ? { ...entry, tags: changes.get(entry.address) ?? [] } : entry))
  for (const update of updates) {
    if (!entries.some((entry) => entry.address === update.address)) {
      next.push({ address: update.address, sources: ['other'], tags: update.tags })
    }
  }
  return next.sort((left, right) => left.address.localeCompare(right.address))
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

function sortSources(sources: AddressTagSource[]): AddressTagSource[] {
  return [...sources].sort((left, right) => SOURCE_ORDER.indexOf(left) - SOURCE_ORDER.indexOf(right))
}
