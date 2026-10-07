import { Check, Copy, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'

type CopyState = 'idle' | 'copied' | 'failed'

// navigator.clipboard 只在安全上下文可用；被拒绝或不可用时退回临时 textarea + execCommand。
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续尝试旧办法
  }
  try {
    const active = document.activeElement as HTMLElement | null
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    active?.focus()
    return copied
  } catch {
    return false
  }
}

/** 复制按钮：成功时绕竖轴翻成对勾并冒出「已复制」气泡，两秒后复原；失败也明说。 */
export function CopyAddressButton({ address }: { address: string }) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    const copied = await copyText(address)
    setState(copied ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <span className="tag-copy" data-state={state}>
      <button className="tag-copy__button" type="button" aria-label={t('复制 {address}', { address })} onClick={() => void copy()}>
        <span className="tag-copy__face" aria-hidden="true"><Copy size={14} /></span>
        <span className="tag-copy__face tag-copy__face--back" aria-hidden="true"><Check size={14} /></span>
      </button>
      <span className="tag-copy__bubble" aria-hidden="true">
        {state === 'failed' ? <X size={12} /> : <Check size={12} />}
        {state === 'failed' ? t('复制失败') : t('已复制')}
      </span>
      <span className="sr-only" role="status">
        {state === 'copied' ? t('已复制：{address}', { address }) : state === 'failed' ? t('复制失败') : ''}
      </span>
    </span>
  )
}
