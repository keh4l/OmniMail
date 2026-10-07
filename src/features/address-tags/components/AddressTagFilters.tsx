import { Check, Funnel, FunnelX, Minus, Search } from 'lucide-react'
import { useMemo } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagEntry, AddressTagSource, AddressTagSummary } from '../api/address-tag-api-client'
import {
  emptyAddressTagFilters,
  hasActiveFilters,
  nextTagFilterState,
  sourceCounts,
  tagKey,
  type AddressTagFilters,
  type TagFilterState,
} from '../model/addressTagFilter'

export function sourceLabel(source: AddressTagSource): string {
  switch (source) {
    case 'omnimail': return t('自有域名')
    case 'icloud': return 'iCloud'
    case 'icloud-hme': return t('iCloud 隐藏邮箱')
    case 'gmail': return 'Gmail'
    case 'microsoft': return 'Microsoft'
    case 'qq': return t('QQ 邮箱')
    case 'naver': return 'NAVER'
    case 'yandex': return 'Yandex'
    case 'linuxdo': return 'Linux DO'
    default: return t('其他地址')
  }
}

function tagStateLabel(state?: TagFilterState): string {
  if (state === 'include') return t('包含')
  if (state === 'exclude') return t('排除')
  return t('不筛选')
}

export function AddressTagFiltersBar({
  entries,
  tags,
  filters,
  onChange,
}: {
  entries: AddressTagEntry[]
  tags: AddressTagSummary[]
  filters: AddressTagFilters
  onChange: (filters: AddressTagFilters) => void
}) {
  const sources = useMemo(() => sourceCounts(entries), [entries])
  const update = (patch: Partial<AddressTagFilters>) => onChange({ ...filters, ...patch })

  function cycleTag(name: string) {
    const key = tagKey(name)
    const next = nextTagFilterState(filters.tags[key])
    const rules = { ...filters.tags }
    if (next) rules[key] = next
    else delete rules[key]
    update({ tags: rules })
  }

  return (
    <div className="address-tags-filters">
      <div className="address-tags-filters__row">
        <label className="address-tags-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            placeholder={t('搜索地址')}
            aria-label={t('搜索地址')}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>
        <div className="address-tags-chips" role="group" aria-label={t('按来源筛选')}>
          <button className="address-tag-filter" type="button" aria-pressed={filters.source === 'all'} onClick={() => update({ source: 'all' })}>
            <span>{t('全部来源')}</span><small>{entries.length}</small>
          </button>
          {sources.map(([source, count]) => (
            <button
              key={source}
              className="address-tag-filter"
              type="button"
              aria-pressed={filters.source === source}
              onClick={() => update({ source: filters.source === source ? 'all' : source })}
            >
              <span>{sourceLabel(source)}</span><small>{count}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="address-tags-filters__row">
        <div className="address-tags-chips" role="group" aria-label={t('按标签筛选')}>
          <span className="address-tags-filters__label"><Funnel size={14} aria-hidden="true" />{t('标签')}</span>
          {tags.map((tag) => {
            const state = filters.tags[tagKey(tag.name)]
            return (
              <button
                key={tag.name}
                className={`address-tag-filter${state ? ` is-${state}` : ''}`}
                type="button"
                aria-pressed={state === 'include' ? true : state === 'exclude' ? 'mixed' : false}
                aria-label={`${tag.name}：${tagStateLabel(state)}`}
                data-tooltip={tagStateLabel(state)}
                onClick={() => cycleTag(tag.name)}
              >
                {state === 'include' && <Check size={12} aria-hidden="true" />}
                {state === 'exclude' && <Minus size={12} aria-hidden="true" />}
                <span>{tag.name}</span><small>{tag.count}</small>
              </button>
            )
          })}
          <button
            className={`address-tag-filter${filters.untaggedOnly ? ' is-include' : ''}`}
            type="button"
            aria-pressed={filters.untaggedOnly}
            onClick={() => update({ untaggedOnly: !filters.untaggedOnly })}
          >
            <span>{t('无标签')}</span>
          </button>
        </div>
        {hasActiveFilters(filters) && (
          <button className="button button--small button--secondary" type="button" onClick={() => onChange(emptyAddressTagFilters)}>
            <FunnelX size={14} />{t('清除筛选')}
          </button>
        )}
      </div>
      <p className="address-tags-hint">
        {t('点击标签依次切换：包含 → 排除 → 不筛选。排除某个网站的标签，就能找出还没注册过它的地址。')}
      </p>
    </div>
  )
}
