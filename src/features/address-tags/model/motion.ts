// 地址标签页的动效工具：借鉴 UI Lab 的 FLIP 补位，只动 transform / opacity，尊重减少动态效果偏好。

export const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface LayoutSnapshot {
  rects: Map<Element, DOMRect>
  height: number
}

export function snapshotLayout(container: HTMLElement): LayoutSnapshot {
  return {
    rects: new Map(Array.from(container.children, (child) => [child, child.getBoundingClientRect()])),
    height: container.getBoundingClientRect().height,
  }
}

const slides = new WeakMap<Element, Animation>()

/** 位置变化的子元素依次错开滑到新位置；容器高度同步过渡，换行和收行都不跳。 */
export function playReflow(container: HTMLElement, before: LayoutSnapshot, stagger = 40): void {
  if (prefersReducedMotion()) return
  let order = 0
  let lastDelay = 0
  for (const child of Array.from(container.children)) {
    const first = before.rects.get(child)
    if (!first) continue
    slides.get(child)?.cancel()
    const last = child.getBoundingClientRect()
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
    lastDelay = Math.min(order * stagger, 240)
    order += 1
    slides.set(child, child.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
      duration: 360, delay: lastDelay, easing: EASE_OUT, fill: 'backwards',
    }))
  }
  const height = container.getBoundingClientRect().height
  if (Math.abs(height - before.height) < 0.5) return
  slides.get(container)?.cancel()
  slides.set(container, container.animate([{ height: `${before.height}px` }, { height: `${height}px` }], {
    duration: 360 + lastDelay, easing: EASE_OUT,
  }))
}

const FULL = 'inset(0px 0px 0px 0px round 999px)'
const DOT = 'inset(calc(50% - 4px) calc(50% - 4px) calc(50% - 4px) calc(50% - 4px) round 999px)'
const NONE = 'inset(50% 50% 50% 50% round 999px)'

/** 标签删除：收成圆点、停顿一下、再缩没；返回动画结束的 Promise。 */
export function playChipLeave(chip: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve()
  chip.dataset.phase = 'leave'
  return chip.animate([
    { clipPath: FULL, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { clipPath: DOT, offset: 0.55, easing: 'linear' },
    { clipPath: DOT, offset: 0.75, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
    { clipPath: NONE },
  ], { duration: 420, fill: 'forwards' }).finished.then(() => undefined, () => undefined)
}

/** 标签添加：先冒出圆点，再展开成完整标签。 */
export function playChipEnter(chip: HTMLElement): void {
  if (prefersReducedMotion()) return
  chip.animate([
    { clipPath: NONE, easing: 'cubic-bezier(0, 0, 0.2, 1)' },
    { clipPath: DOT, offset: 0.3, easing: EASE_OUT },
    { clipPath: FULL },
  ], { duration: 380 })
}

const JUMP_THRESHOLD = 12

/**
 * 筛选标签宽度过渡期间逐帧检测换行跳变，用 FLIP 从上一帧的视觉位置滑到新位置。
 * 需要在状态更新前调用，第一次测量即为变化前的位置；返回取消函数。
 */
export function slideOnReflow(group: HTMLElement, watchMs = 520): () => void {
  if (prefersReducedMotion()) return () => undefined
  const chips = Array.from(group.children) as HTMLElement[]
  const natural = () => chips.map((chip) => ({ x: chip.offsetLeft, y: chip.offsetTop }))
  const visual = () => {
    const origin = group.getBoundingClientRect()
    return chips.map((chip) => {
      const rect = chip.getBoundingClientRect()
      return { x: rect.left - origin.left, y: rect.top - origin.top }
    })
  }
  let lastNatural = natural()
  let lastVisual = visual()
  let frame = 0
  const start = performance.now()
  const tick = () => {
    const now = natural()
    now.forEach((position, index) => {
      const previous = lastNatural[index]
      if (!previous || (position.y === previous.y && Math.abs(position.x - previous.x) < JUMP_THRESHOLD)) return
      const from = lastVisual[index]
      const chip = chips[index]
      const dx = from.x - position.x
      const dy = from.y - position.y
      slides.get(chip)?.cancel()
      slides.set(chip, chip.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
        duration: Math.min(520, 260 + Math.hypot(dx, dy) * 0.5), easing: EASE_OUT,
      }))
    })
    lastNatural = now
    lastVisual = visual()
    if (performance.now() - start < watchMs) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
