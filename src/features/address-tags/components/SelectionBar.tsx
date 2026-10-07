import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagSummary } from '../api/address-tag-api-client'
import { TagSuggestInput } from './TagSuggestInput'

type BulkMode = 'add' | 'remove'

/** 选中地址后从底部升起的批量操作栏；选择清空时沉回去。 */
export function SelectionBar({
  count,
  suggestions,
  removable,
  busy,
  onApply,
  onClear,
}: {
  count: number
  suggestions: AddressTagSummary[]
  removable: AddressTagSummary[]
  busy: boolean
  onApply: (mode: BulkMode, tag: string) => void
  onClear: () => void
}) {
  const [mode, setMode] = useState<BulkMode>('add')
  // 收起动画期间保留最后一个数量，避免数字先变成 0 再沉下去。
  const [shown, setShown] = useState(count)
  const open = count > 0

  useEffect(() => {
    if (count > 0) setShown(count)
  }, [count])

  return (
    <div className="tag-selection" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="tag-selection__panel" role="region" aria-label={t('批量编辑标签')} aria-busy={busy}>
        <span className="tag-selection__count">
          <strong key={shown}>{shown}</strong>
          <span>{t('个地址已选择')}</span>
        </span>
        <span className="tag-mode tag-selection__mode" role="radiogroup" aria-label={t('批量操作')} data-mode={mode === 'add' ? 'include' : 'exclude'}>
          <span className="tag-mode__thumb" aria-hidden="true" />
          <button type="button" role="radio" aria-checked={mode === 'add'} onClick={() => setMode('add')}>
            <Plus size={13} aria-hidden="true" />{t('添加')}
          </button>
          <button type="button" role="radio" aria-checked={mode === 'remove'} onClick={() => setMode('remove')}>
            <Minus size={13} aria-hidden="true" />{t('移除')}
          </button>
        </span>
        <TagSuggestInput
          key={mode}
          className="tag-selection__input"
          tags={mode === 'add' ? suggestions : removable}
          allowCreate={mode === 'add'}
          label={mode === 'add' ? t('给所选地址添加标签') : t('从所选地址移除标签')}
          placeholder={mode === 'add' ? t('输入标签，回车添加到所选') : t('选择要移除的标签')}
          onSubmit={(tag) => onApply(mode, tag)}
        />
        <button className="tag-selection__close" type="button" aria-label={t('取消选择')} data-tooltip={t('取消选择')} onClick={onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
