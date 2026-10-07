import { Plus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagSummary } from '../api/address-tag-api-client'
import { tagKey, withTag, withoutTag } from '../model/addressTagFilter'
import { playChipEnter, playChipLeave, playReflow, snapshotLayout, type LayoutSnapshot } from '../model/motion'
import { TagSuggestInput } from './TagSuggestInput'

export const TAGS_PER_ADDRESS = 20

/**
 * 一个地址的标签：先在界面上乐观更新并播放动效，再保存；保存失败时回滚。
 * 删除时标签缩成圆点消失、后面的依次补位；添加时从圆点展开。
 */
export function AddressRowTags({
  address,
  tags: savedTags,
  suggestions,
  canAdd = true,
  onSave,
}: {
  address: string
  tags: string[]
  suggestions: AddressTagSummary[]
  canAdd?: boolean
  onSave: (address: string, tags: string[]) => Promise<string[] | null>
}) {
  const [tags, setTags] = useState(savedTags)
  const [adding, setAdding] = useState(false)
  const pending = useRef(0)
  const latest = useRef(savedTags)
  const listRef = useRef<HTMLSpanElement>(null)
  const chips = useRef(new Map<string, HTMLElement>())
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  const reflow = useRef<LayoutSnapshot | null>(null)
  const entering = useRef<string | null>(null)

  // 没有进行中的保存时，以服务端结果为准（例如批量操作或重命名后的刷新）。
  useEffect(() => {
    if (pending.current) return
    latest.current = savedTags
    setTags(savedTags)
  }, [savedTags])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && reflow.current) playReflow(list, reflow.current)
    reflow.current = null
    const key = entering.current
    entering.current = null
    const chip = key ? chips.current.get(key) : undefined
    if (chip) playChipEnter(chip)
  }, [tags])

  async function persist(next: string[], previous: string[]) {
    pending.current += 1
    latest.current = next
    const saved = await onSave(address, next)
    pending.current -= 1
    if (latest.current !== next) return
    // 成功时以服务端结果为准（例如统一成已有标签的写法）；失败时回滚。
    const result = saved ?? previous
    latest.current = result
    setTags(result)
  }

  function update(next: string[]) {
    if (listRef.current) reflow.current = snapshotLayout(listRef.current)
    const previous = latest.current
    setTags(next)
    void persist(next, previous)
  }

  async function remove(tag: string) {
    const key = tagKey(tag)
    const chip = chips.current.get(key)
    const visible = latest.current
    const index = visible.findIndex((current) => tagKey(current) === key)
    const neighbour = visible[index + 1] ?? visible[index - 1]
    if (chip) await playChipLeave(chip)
    update(withoutTag(latest.current, tag))
    if (neighbour) removeButtons.current.get(tagKey(neighbour))?.focus()
  }

  function add(tag: string) {
    const next = withTag(latest.current, tag)
    if (next === latest.current || next.length > TAGS_PER_ADDRESS) return
    entering.current = tagKey(tag)
    update(next)
  }

  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, tag: string) {
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.repeat) {
      event.preventDefault()
      void remove(tag)
    }
  }

  const full = tags.length >= TAGS_PER_ADDRESS

  return (
    <span className="tag-row__tags">
      <span ref={listRef} className="tag-chip-list" role="group" aria-label={t('{address} 的标签', { address })}>
        {tags.map((tag) => (
          <span
            key={tagKey(tag)}
            className="tag-chip"
            ref={(node) => {
              if (node) chips.current.set(tagKey(tag), node)
              else chips.current.delete(tagKey(tag))
            }}
          >
            <span className="tag-chip__label">{tag}</span>
            <button
              type="button"
              className="tag-chip__remove"
              aria-label={t('移除标签 {tag}', { tag })}
              ref={(node) => {
                if (node) removeButtons.current.set(tagKey(tag), node)
                else removeButtons.current.delete(tagKey(tag))
              }}
              onClick={() => void remove(tag)}
              onKeyDown={(event) => onChipKeyDown(event, tag)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
        {adding ? (
          <TagSuggestInput
            className="tag-row__input"
            tags={suggestions}
            exclude={tags}
            label={t('为 {address} 添加标签', { address })}
            placeholder={t('输入标签，回车添加')}
            autoFocus
            onSubmit={add}
            onCancel={() => setAdding(false)}
            onBackspaceEmpty={() => {
              const last = latest.current[latest.current.length - 1]
              if (last) removeButtons.current.get(tagKey(last))?.focus()
            }}
          />
        ) : canAdd && !full && (
          <button
            type="button"
            className={`tag-add${tags.length ? ' is-compact' : ''}`}
            aria-label={t('为 {address} 添加标签', { address })}
            data-tooltip={tags.length ? t('添加标签') : undefined}
            onClick={() => setAdding(true)}
          >
            <Plus size={13} aria-hidden="true" />
            {!tags.length && <span>{t('添加标签')}</span>}
          </button>
        )}
      </span>
    </span>
  )
}
