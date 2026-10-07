import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagSource } from '../api/address-tag-api-client'
import { AnchoredPopover } from './AnchoredPopover'
import { sourceLabel } from './sourceLabel'

/** 来源筛选菜单：按钮弹出单选菜单，↑↓ 移动、回车选中、Esc 收起并把焦点还给按钮。 */
export function SourceMenu({
  sources,
  total,
  value,
  onChange,
}: {
  sources: Array<[AddressTagSource, number]>
  total: number
  value: AddressTagSource | 'all'
  onChange: (value: AddressTagSource | 'all') => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const options: Array<[AddressTagSource | 'all', number]> = [['all', total], ...sources]
  const close = useCallback(() => setOpen(false), [])

  function openMenu() {
    setOpen(true)
    const index = Math.max(0, options.findIndex(([source]) => source === value))
    window.requestAnimationFrame(() => items.current[index]?.focus())
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.current.findIndex((item) => item === document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items.current[(index + step + options.length) % options.length]?.focus()
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <>
      <button
        ref={button}
        className="tag-source-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={value !== 'all'}
        onClick={() => (open ? close() : openMenu())}
      >
        <span>{value === 'all' ? t('全部来源') : sourceLabel(value)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <AnchoredPopover open={open} anchorRef={button} onClose={close} align="end" label={t('按来源筛选')} className="tag-menu">
        <div role="menu" aria-label={t('按来源筛选')} onKeyDown={onMenuKeyDown}>
          {options.map(([source, count], index) => (
            <button
              key={source}
              ref={(node) => { items.current[index] = node }}
              className="tag-menu__item"
              type="button"
              role="menuitemradio"
              aria-checked={source === value}
              data-stagger=""
              style={{ '--i': index } as React.CSSProperties}
              onClick={() => {
                onChange(source)
                close()
                button.current?.focus()
              }}
            >
              <Check className="tag-menu__check" size={14} aria-hidden="true" />
              <span>{source === 'all' ? t('全部来源') : sourceLabel(source)}</span>
              <small>{count}</small>
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </>
  )
}
