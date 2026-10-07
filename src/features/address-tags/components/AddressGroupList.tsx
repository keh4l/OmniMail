import { ChevronDown, Eraser } from 'lucide-react'
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagEntry, AddressTagSource, AddressTagSummary } from '../api/address-tag-api-client'
import { isStaleEntry, type AddressGroup } from '../model/addressTagFilter'
import { prefersReducedMotion } from '../model/motion'
import { AddressRowTags } from './AddressRowTags'
import { CopyAddressButton } from './CopyAddressButton'
import { sourceLabel } from './sourceLabel'

interface ListActions {
  selected: Set<string>
  suggestions: AddressTagSummary[]
  onSelect: (address: string, checked: boolean, range: boolean) => void
  onSave: (address: string, tags: string[]) => Promise<string[] | null>
}

interface StaleActions {
  /** iCloud 隐藏邮箱读取完成前，部分地址会暂时显示为已不在邮箱里，此时不提供清理。 */
  canClearStale: boolean
  onClearStale: (entries: AddressTagEntry[]) => Promise<boolean>
}

function AddressRow({ entry, selected, suggestions, onSelect, onSave }: Omit<ListActions, 'selected'> & {
  entry: AddressTagEntry
  selected: boolean
}) {
  const at = entry.address.lastIndexOf('@')
  return (
    <li className="tag-row" data-selected={selected}>
      <span className="tag-check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={t('选择 {address}', { address: entry.address })}
          onChange={() => undefined}
          onClick={(event: MouseEvent<HTMLInputElement>) => onSelect(entry.address, !selected, event.shiftKey)}
        />
      </span>
      <span className="tag-row__address">
        <span className="tag-row__text" title={entry.address}>
          <span>{entry.address.slice(0, at)}</span><span className="tag-row__domain">{entry.address.slice(at)}</span>
        </span>
        <CopyAddressButton address={entry.address} />
        {entry.sources.slice(1).map((source) => <span className="tag-row__badge" key={source}>{sourceLabel(source)}</span>)}
        {entry.isActive === false && <span className="tag-row__badge is-muted">{t('已停用')}</span>}
      </span>
      <AddressRowTags
        address={entry.address}
        tags={entry.tags}
        suggestions={suggestions}
        canAdd={!isStaleEntry(entry)}
        onSave={onSave}
      />
    </li>
  )
}

function StaleGroupNote({ entries, canClear, onClear }: {
  entries: AddressTagEntry[]
  canClear: boolean
  onClear: StaleActions['onClearStale']
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="tag-stale">
      <p>{t('这些地址已不在你的邮箱里（例如账号已删除），只能移除标签。重新添加这个邮箱后，标签会自动恢复。')}</p>
      {canClear && (confirming ? (
        <span className="tag-stale__actions">
          <button className="tag-text-button is-danger" type="button" disabled={busy} onClick={async () => {
            setBusy(true)
            if (!await onClear(entries)) setBusy(false)
          }}>
            {t('清除 {count} 个地址的标签', { count: entries.length })}
          </button>
          <button className="tag-text-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>{t('取消')}</button>
        </span>
      ) : (
        <button className="tag-text-button tag-stale__clear" type="button" onClick={() => setConfirming(true)}>
          <Eraser size={13} aria-hidden="true" />{t('清理')}
        </button>
      ))}
    </div>
  )
}

function AddressGroupSection({ group, collapsed, onToggle, onSelectGroup, canClearStale, onClearStale, ...actions }: ListActions & StaleActions & {
  group: AddressGroup
  collapsed: boolean
  onToggle: (source: AddressTagSource) => void
  onSelectGroup: (group: AddressGroup, checked: boolean) => void
}) {
  const bodyId = useId()
  const checkbox = useRef<HTMLInputElement>(null)
  // 折叠动画期间裁切内容；展开完成后恢复可见溢出，避免裁掉行内的标签联想浮层。
  const [animating, setAnimating] = useState(false)
  const chosen = group.entries.filter((entry) => actions.selected.has(entry.address)).length
  const tagged = group.entries.filter((entry) => entry.tags.length > 0).length
  const label = sourceLabel(group.source)

  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = chosen > 0 && chosen < group.entries.length
  }, [chosen, group.entries.length])

  return (
    <section className="tag-group" data-collapsed={collapsed} data-animating={animating}>
      <header className="tag-group__header">
        <span className="tag-check">
          <input
            ref={checkbox}
            type="checkbox"
            checked={chosen === group.entries.length}
            aria-label={t('选择{source}的全部地址', { source: label })}
            onChange={(event) => onSelectGroup(group, event.target.checked)}
          />
        </span>
        <button
          className="tag-group__toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => {
            if (!prefersReducedMotion()) {
              setAnimating(true)
              // 不支持 grid 行过渡的浏览器不会触发 transitionend，超时兜底恢复溢出可见。
              window.setTimeout(() => setAnimating(false), 450)
            }
            onToggle(group.source)
          }}
        >
          <ChevronDown className="tag-group__chevron" size={15} aria-hidden="true" />
          <span className="tag-group__title">{label}</span>
          <span className="tag-group__count">{group.entries.length}</span>
        </button>
        <span className="tag-group__meta">{t('已打标签 {tagged} / {total}', { tagged, total: group.entries.length })}</span>
      </header>
      <div
        id={bodyId}
        className="tag-group__body"
        inert={collapsed}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setAnimating(false)
        }}
      >
        <ul className="tag-group__rows">
          {group.source === 'other' && (
            <li><StaleGroupNote entries={group.entries} canClear={canClearStale} onClear={onClearStale} /></li>
          )}
          {group.entries.map((entry) => (
            <AddressRow
              key={entry.address}
              entry={entry}
              selected={actions.selected.has(entry.address)}
              suggestions={actions.suggestions}
              onSelect={actions.onSelect}
              onSave={actions.onSave}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}

export function AddressGroupList({ groups, collapsed, onToggleGroup, onSelectGroup, ...actions }: ListActions & StaleActions & {
  groups: AddressGroup[]
  collapsed: Set<AddressTagSource>
  onToggleGroup: (source: AddressTagSource) => void
  onSelectGroup: (group: AddressGroup, checked: boolean) => void
}) {
  return (
    <div className="tag-groups" data-selecting={actions.selected.size > 0}>
      {groups.map((group) => (
        <AddressGroupSection
          key={group.source}
          group={group}
          collapsed={collapsed.has(group.source)}
          onToggle={onToggleGroup}
          onSelectGroup={onSelectGroup}
          {...actions}
        />
      ))}
    </div>
  )
}
