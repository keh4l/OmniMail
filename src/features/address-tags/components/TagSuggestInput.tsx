import { Plus, Tag } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagSummary } from '../api/address-tag-api-client'
import { normalizeTagInput, tagKey } from '../model/addressTagFilter'

const MAX_OPTIONS = 6

interface Option {
  id: string
  tag: string
  count?: number
  create?: boolean
}

// 已有标签按前缀匹配优先、其次按使用次数；输入的新名字不存在时追加「创建」选项。
export function tagOptions(query: string, tags: AddressTagSummary[], exclude: string[], allowCreate = true): Option[] {
  const excluded = new Set(exclude.map(tagKey))
  const needle = tagKey(query.trim())
  const matches: Option[] = tags
    .filter((tag) => !excluded.has(tagKey(tag.name)) && tagKey(tag.name).includes(needle))
    .sort((left, right) => Number(tagKey(right.name).startsWith(needle)) - Number(tagKey(left.name).startsWith(needle))
      || right.count - left.count)
    .slice(0, MAX_OPTIONS)
    .map((tag) => ({ id: `tag-${tagKey(tag.name)}`, tag: tag.name, count: tag.count }))
  const created = normalizeTagInput(query)
  const known = created && tags.some((tag) => tagKey(tag.name) === tagKey(created))
  if (allowCreate && created && !known && !excluded.has(tagKey(created))) matches.push({ id: 'create', tag: created, create: true })
  return matches
}

/** 带联想浮层的标签输入框：↑↓ 切换、回车选中、Esc 取消；输入法组字时不提交。 */
export function TagSuggestInput({
  tags,
  exclude = [],
  label,
  placeholder,
  autoFocus = false,
  allowCreate = true,
  className = '',
  onSubmit,
  onCancel,
  onBackspaceEmpty,
}: {
  tags: AddressTagSummary[]
  exclude?: string[]
  label: string
  placeholder: string
  autoFocus?: boolean
  allowCreate?: boolean
  className?: string
  onSubmit: (tag: string) => void
  onCancel?: () => void
  onBackspaceEmpty?: () => void
}) {
  const listId = useId()
  const fieldRef = useRef<HTMLSpanElement>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const [openUp, setOpenUp] = useState(false)
  const options = useMemo(() => tagOptions(query, tags, exclude, allowCreate), [query, tags, exclude, allowCreate])
  const open = focused && options.length > 0
  const activeIndex = Math.min(active, options.length - 1)

  useLayoutEffect(() => {
    if (!open || !fieldRef.current) return
    const rect = fieldRef.current.getBoundingClientRect()
    const needed = options.length * 34 + 16
    setOpenUp(window.innerHeight - rect.bottom < needed && rect.top > window.innerHeight - rect.bottom)
  }, [open, options.length])

  function choose(option?: Option) {
    const tag = option?.tag ?? (allowCreate ? normalizeTagInput(query) : null)
    if (!tag) return
    onSubmit(tag)
    setQuery('')
    setActive(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + options.length) % options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(open ? options[activeIndex] : undefined)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (query) setQuery('')
      else onCancel?.()
    } else if (event.key === 'Backspace' && !query && !event.repeat) {
      onBackspaceEmpty?.()
    }
  }

  return (
    <span ref={fieldRef} className={`tag-suggest ${className}`.trim()}>
      <input
        className="tag-suggest__input"
        value={query}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${options[activeIndex].id}` : undefined}
        placeholder={placeholder}
        maxLength={64}
        autoFocus={autoFocus}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          if (!query.trim()) onCancel?.()
        }}
        onKeyDown={onKeyDown}
      />
      <span
        className="tag-suggest__popover"
        data-open={open}
        data-side={openUp ? 'top' : 'bottom'}
        style={{ '--tag-suggest-index': activeIndex } as CSSProperties}
      >
        <span className="tag-suggest__highlight" aria-hidden="true" />
        <span id={listId} role="listbox" aria-label={t('标签建议')} className="tag-suggest__list">
          {options.map((option, index) => (
            <span
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className="tag-suggest__option"
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.create ? <Plus size={13} aria-hidden="true" /> : <Tag size={13} aria-hidden="true" />}
              <span className="tag-suggest__label">
                {option.create ? t('创建“{tag}”', { tag: option.tag }) : option.tag}
              </span>
              {option.count !== undefined && <small>{option.count}</small>}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
