import { Copy, LoaderCircle, Plus, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagEntry } from '../api/address-tag-api-client'
import { normalizeTagInput, withTag, withoutTag } from '../model/addressTagFilter'
import { sourceLabel } from './AddressTagFilters'

export const ADDRESS_TAG_SUGGESTIONS_ID = 'address-tag-suggestions'
export const TAGS_PER_ADDRESS = 20

export function AddressTagRow({
  entry,
  selected,
  onSelect,
  onSave,
  onCopy,
}: {
  entry: AddressTagEntry
  selected: boolean
  onSelect: (address: string, selected: boolean) => void
  onSave: (address: string, tags: string[]) => Promise<boolean>
  onCopy: (address: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [invalid, setInvalid] = useState(false)

  async function commit(tags: string[]): Promise<boolean> {
    setSaving(true)
    const saved = await onSave(entry.address, tags)
    setSaving(false)
    return saved
  }

  async function addDraft() {
    const tag = normalizeTagInput(draft)
    const next = tag ? withTag(entry.tags, tag) : entry.tags
    if (!tag || next.length > TAGS_PER_ADDRESS) {
      setInvalid(true)
      return
    }
    if (next === entry.tags || await commit(next)) setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 输入法组字期间的回车用于确认候选词，不能当作提交。
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void addDraft()
  }

  return (
    <li className={`address-tags-row${selected ? ' is-selected' : ''}`}>
      <input
        className="address-tags-row__check"
        type="checkbox"
        checked={selected}
        aria-label={t('选择 {address}', { address: entry.address })}
        onChange={(event) => onSelect(entry.address, event.target.checked)}
      />
      <div className="address-tags-row__main">
        <div className="address-tags-row__address">
          <strong>{entry.address}</strong>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label={t('复制地址')}
            data-tooltip={t('复制地址')}
            onClick={() => onCopy(entry.address)}
          >
            <Copy size={14} />
          </button>
          {entry.sources.map((source) => (
            <span className={`address-tags-source is-${source}`} key={source}>{sourceLabel(source)}</span>
          ))}
          {entry.isActive === false && <span className="address-tags-source is-inactive">{t('已停用')}</span>}
        </div>
        <div className="address-tags-row__tags">
          {entry.tags.map((tag) => (
            <span className="address-tag-chip" key={tag}>
              <span>{tag}</span>
              <button
                type="button"
                disabled={saving}
                aria-label={t('移除标签 {tag}', { tag })}
                onClick={() => void commit(withoutTag(entry.tags, tag))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="address-tag-add">
            <input
              value={draft}
              list={ADDRESS_TAG_SUGGESTIONS_ID}
              maxLength={64}
              placeholder={t('添加标签')}
              aria-label={t('为 {address} 添加标签', { address: entry.address })}
              aria-invalid={invalid || undefined}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value)
                setInvalid(false)
              }}
              onKeyDown={onKeyDown}
            />
            <button
              className="icon-button icon-button--small"
              type="button"
              disabled={saving || !draft.trim()}
              aria-label={t('添加标签')}
              onClick={() => void addDraft()}
            >
              {saving ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
            </button>
          </span>
        </div>
      </div>
    </li>
  )
}
