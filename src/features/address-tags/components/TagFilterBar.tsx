import { Ban, Check, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagEntry, AddressTagSummary } from '../api/address-tag-api-client'
import {
  emptyAddressTagFilters,
  hasActiveFilters,
  sourceCounts,
  tagKey,
  toggleTagFilter,
  withoutTagFilter,
  type AddressTagFilters,
  type TagFilterState,
} from '../model/addressTagFilter'
import { slideOnReflow } from '../model/motion'
import { SourceMenu } from './SourceMenu'
import { sourceLabel } from './sourceLabel'

function ChipIcon() {
  return (
    <span className="tag-filter-chip__icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="tag-filter-chip__check"><path d="M3 8.5l3.2 3.2L13 4.8" pathLength={1} /></svg>
      <svg viewBox="0 0 16 16" className="tag-filter-chip__ban"><circle cx="8" cy="8" r="5.6" pathLength={1} /><path d="M4 12 12 4" pathLength={1} /></svg>
    </span>
  )
}

export function TagFilterBar({
  entries,
  tags,
  filters,
  mode,
  resultCount,
  searchRef,
  onChange,
  onModeChange,
}: {
  entries: AddressTagEntry[]
  tags: AddressTagSummary[]
  filters: AddressTagFilters
  mode: TagFilterState
  resultCount: number
  searchRef: RefObject<HTMLInputElement | null>
  onChange: (filters: AddressTagFilters) => void
  onModeChange: (mode: TagFilterState) => void
}) {
  const chipsRef = useRef<HTMLSpanElement>(null)
  const stopSlide = useRef<() => void>(() => undefined)
  const sources = useMemo(() => sourceCounts(entries), [entries])
  const names = useMemo(() => new Map(tags.map((tag) => [tagKey(tag.name), tag.name])), [tags])
  const active = hasActiveFilters(filters)

  useEffect(() => () => stopSlide.current(), [])

  // 状态更新前开始逐帧观察，标签撑开导致换行时平滑滑到新位置。
  function change(next: AddressTagFilters) {
    stopSlide.current()
    if (chipsRef.current) stopSlide.current = slideOnReflow(chipsRef.current)
    onChange(next)
  }

  const conditions = [
    ...Object.entries(filters.tags).map(([key, state]) => ({
      id: `tag-${key}`,
      label: state === 'include' ? t('有“{tag}”', { tag: names.get(key) ?? key }) : t('没有“{tag}”', { tag: names.get(key) ?? key }),
      state,
      clear: () => change(withoutTagFilter(filters, key)),
    })),
    ...(filters.untaggedOnly ? [{ id: 'untagged', label: t('无标签'), state: 'include' as const, clear: () => change({ ...filters, untaggedOnly: false }) }] : []),
    ...(filters.source !== 'all' ? [{ id: 'source', label: t('来源：{source}', { source: sourceLabel(filters.source) }), state: 'include' as const, clear: () => onChange({ ...filters, source: 'all' }) }] : []),
    ...(filters.query.trim() ? [{ id: 'query', label: t('地址含“{query}”', { query: filters.query.trim() }), state: 'include' as const, clear: () => onChange({ ...filters, query: '' }) }] : []),
  ]

  return (
    <section className="tag-query" aria-label={t('筛选地址')}>
      <div className="tag-query__top">
        <label className="tag-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            placeholder={t('搜索地址')}
            aria-label={t('搜索地址')}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
          />
          {filters.query ? (
            <button type="button" className="tag-search__clear" aria-label={t('清除搜索')} onClick={() => onChange({ ...filters, query: '' })}>
              <X size={13} aria-hidden="true" />
            </button>
          ) : <kbd aria-hidden="true">/</kbd>}
        </label>
        <SourceMenu sources={sources} total={entries.length} value={filters.source} onChange={(source) => onChange({ ...filters, source })} />
      </div>
      <div className="tag-query__tags">
        <span className="tag-mode" role="radiogroup" aria-label={t('点击标签时')} data-mode={mode}>
          <span className="tag-mode__thumb" aria-hidden="true" />
          <button type="button" role="radio" aria-checked={mode === 'include'} onClick={() => onModeChange('include')}>
            <Check size={13} aria-hidden="true" />{t('包含')}
          </button>
          <button type="button" role="radio" aria-checked={mode === 'exclude'} onClick={() => onModeChange('exclude')}>
            <Ban size={13} aria-hidden="true" />{t('排除')}
          </button>
        </span>
        <span ref={chipsRef} className="tag-filter-chips" role="group" aria-label={t('按标签筛选')}>
          {tags.map((tag) => {
            const state = filters.tags[tagKey(tag.name)]
            return (
              <button
                key={tagKey(tag.name)}
                type="button"
                className="tag-filter-chip"
                data-state={state ?? 'off'}
                aria-pressed={Boolean(state)}
                aria-label={state ? `${tag.name}：${state === 'include' ? t('包含') : t('排除')}` : tag.name}
                onClick={() => change(toggleTagFilter(filters, tag.name, mode))}
              >
                <ChipIcon />
                <span className="tag-filter-chip__label">{tag.name}</span>
                <small>{tag.count}</small>
              </button>
            )
          })}
          <button
            type="button"
            className="tag-filter-chip is-untagged"
            data-state={filters.untaggedOnly ? 'include' : 'off'}
            aria-pressed={filters.untaggedOnly}
            onClick={() => change({ ...filters, untaggedOnly: !filters.untaggedOnly })}
          >
            <ChipIcon />
            <span className="tag-filter-chip__label">{t('无标签')}</span>
          </button>
        </span>
      </div>
      {!tags.length && <p className="tag-query__hint">{t('还没有标签。在地址行末点“+”给地址打上网站名，之后就能在这里筛选。')}</p>}
      <div className="tag-query__summary" data-open={active} aria-hidden={!active} inert={!active}>
        <span className="tag-query__result">{t('显示 {count} 个地址', { count: resultCount })}</span>
        {conditions.map((condition) => (
          <span className="tag-condition" data-state={condition.state} key={condition.id}>
            {condition.label}
            <button type="button" aria-label={t('移除条件 {condition}', { condition: condition.label })} onClick={condition.clear}>
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
        <button type="button" className="tag-query__clear" onClick={() => onChange(emptyAddressTagFilters)}>{t('清除全部')}</button>
      </div>
    </section>
  )
}
