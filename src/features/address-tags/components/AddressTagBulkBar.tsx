import { Minus, Plus, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import { normalizeTagInput } from '../model/addressTagFilter'
import { ADDRESS_TAG_SUGGESTIONS_ID } from './AddressTagRow'

export function AddressTagBulkBar({
  count,
  busy,
  onApply,
  onClear,
}: {
  count: number
  busy: boolean
  onApply: (change: { add?: string[]; remove?: string[] }) => Promise<boolean>
  onClear: () => void
}) {
  const [draft, setDraft] = useState('')
  const tag = normalizeTagInput(draft)

  async function apply(change: 'add' | 'remove') {
    if (!tag) return
    if (await onApply({ [change]: [tag] })) setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void apply('add')
  }

  return (
    <div className="address-tags-bulk" role="region" aria-label={t('批量编辑标签')}>
      <strong>{t('已选择 {count} 个地址', { count })}</strong>
      <input
        value={draft}
        list={ADDRESS_TAG_SUGGESTIONS_ID}
        maxLength={64}
        placeholder={t('输入标签')}
        aria-label={t('批量操作的标签')}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="button button--small button--primary" type="button" disabled={busy || !tag} onClick={() => void apply('add')}>
        <Plus size={14} />{t('添加到所选')}
      </button>
      <button className="button button--small button--secondary" type="button" disabled={busy || !tag} onClick={() => void apply('remove')}>
        <Minus size={14} />{t('从所选移除')}
      </button>
      <button className="button button--small button--secondary" type="button" disabled={busy} onClick={onClear}>
        <X size={14} />{t('取消选择')}
      </button>
    </div>
  )
}
