import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Placement {
  top: number
  left?: number
  right?: number
  side: 'top' | 'bottom'
}

/**
 * 从触发按钮长出来的浮层：挂到 body 上用 fixed 定位，避免被吸顶页头或卡片裁切；
 * 下方放不下而上方更宽裕时改往上弹。开合只切换 data-open，交给 CSS 过渡。
 */
export function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  align = 'start',
  className = '',
  label,
  children,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  align?: 'start' | 'end'
  className?: string
  label: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return
      const rect = anchor.getBoundingClientRect()
      const height = panel.offsetHeight
      const below = window.innerHeight - rect.bottom
      const side = below < height + 16 && rect.top > below ? 'top' : 'bottom'
      setPlacement({
        top: side === 'top' ? Math.max(8, rect.top - 8 - height) : rect.bottom + 8,
        ...(align === 'end' ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
        side,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      anchorRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, anchorRef])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      className={`tag-popover ${className}`.trim()}
      role="dialog"
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      data-open={open}
      data-side={placement?.side ?? 'bottom'}
      data-align={align}
      style={placement ? { top: placement.top, left: placement.left, right: placement.right } : undefined}
    >
      {children}
    </div>,
    document.body,
  )
}
