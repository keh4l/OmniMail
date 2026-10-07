import { describe, expect, it } from 'vitest'
import type { AddressTagEntry } from '../api/address-tag-api-client'
import {
  applyAddressTagUpdates,
  emptyAddressTagFilters,
  filterAddressEntries,
  hasActiveFilters,
  mergeHideMyEmailAliases,
  groupEntriesBySource,
  toggleTagFilter,
  withoutTagFilter,
  normalizeTagInput,
  sourceCounts,
  tagSummaries,
  withTag,
  withoutTag,
} from './addressTagFilter'

const entries: AddressTagEntry[] = [
  { address: 'a@mine.test', sources: ['omnimail'], isActive: true, tags: ['网站A', 'GitHub'] },
  { address: 'b@mine.test', sources: ['omnimail'], isActive: false, tags: ['网站B'] },
  { address: 'c@gmail.com', sources: ['gmail'], tags: [] },
  { address: 'old@site.test', sources: ['other'], tags: ['github'] },
]

const addresses = (list: AddressTagEntry[]) => list.map((entry) => entry.address)

describe('address tag filters', () => {
  it('finds addresses that have not registered on a site yet', () => {
    expect(addresses(filterAddressEntries(entries, { ...emptyAddressTagFilters, tags: { 网站A: 'exclude' } }))).toEqual([
      'b@mine.test', 'c@gmail.com', 'old@site.test',
    ])
  })

  it('requires every included tag and matches tags case-insensitively', () => {
    expect(addresses(filterAddressEntries(entries, { ...emptyAddressTagFilters, tags: { github: 'include' } }))).toEqual([
      'a@mine.test', 'old@site.test',
    ])
    expect(addresses(filterAddressEntries(entries, {
      ...emptyAddressTagFilters, tags: { github: 'include', 网站A: 'include' },
    }))).toEqual(['a@mine.test'])
  })

  it('combines source, keyword and untagged filters', () => {
    expect(addresses(filterAddressEntries(entries, { ...emptyAddressTagFilters, source: 'omnimail', query: 'B@' }))).toEqual(['b@mine.test'])
    expect(addresses(filterAddressEntries(entries, { ...emptyAddressTagFilters, untaggedOnly: true }))).toEqual(['c@gmail.com'])
    expect(hasActiveFilters(emptyAddressTagFilters)).toBe(false)
    expect(hasActiveFilters({ ...emptyAddressTagFilters, untaggedOnly: true })).toBe(true)
  })

  it('toggles a tag according to the current include or exclude mode', () => {
    const included = toggleTagFilter(emptyAddressTagFilters, '网站A', 'include')
    expect(included.tags).toEqual({ 网站a: 'include' })
    expect(toggleTagFilter(included, '网站A', 'exclude').tags).toEqual({ 网站a: 'exclude' })
    expect(toggleTagFilter(included, '网站a', 'include').tags).toEqual({})
    expect(withoutTagFilter(included, '网站A').tags).toEqual({})
  })

  it('groups addresses by their primary source in a stable order', () => {
    expect(groupEntriesBySource(entries).map((group) => [group.source, group.entries.length])).toEqual([
      ['omnimail', 2], ['gmail', 1], ['other', 1],
    ])
  })
})

describe('address tag helpers', () => {
  it('normalizes tag input like the Worker', () => {
    expect(normalizeTagInput('  网站\n A ')).toBe('网站 A')
    expect(normalizeTagInput('')).toBeNull()
    expect(normalizeTagInput('x'.repeat(33))).toBeNull()
    expect(withTag(['GitHub'], 'github')).toEqual(['GitHub'])
    expect(withoutTag(['GitHub', '网站A'], 'GITHUB')).toEqual(['网站A'])
  })

  it('merges iCloud Hide My Email aliases into the address list', () => {
    const merged = mergeHideMyEmailAliases(entries, ['OLD@site.test', 'new@privaterelay.test'])
    expect(merged.find((entry) => entry.address === 'old@site.test')?.sources).toEqual(['icloud-hme'])
    expect(merged.find((entry) => entry.address === 'new@privaterelay.test')).toEqual({
      address: 'new@privaterelay.test', sources: ['icloud-hme'], tags: [],
    })
    expect(sourceCounts(merged)).toEqual([['omnimail', 2], ['icloud-hme', 2], ['gmail', 1]])
  })

  it('applies server updates and recomputes tag counts', () => {
    const updated = applyAddressTagUpdates(entries, [
      { address: 'c@gmail.com', tags: ['网站A'] },
      { address: 'manual@else.test', tags: ['网站C'] },
    ])
    expect(updated.find((entry) => entry.address === 'manual@else.test')?.sources).toEqual(['other'])
    expect(tagSummaries(updated)).toEqual([
      { name: 'GitHub', count: 2 },
      { name: '网站A', count: 2 },
      { name: '网站B', count: 1 },
      { name: '网站C', count: 1 },
    ])
  })
})
