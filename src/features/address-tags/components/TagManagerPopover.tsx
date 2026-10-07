import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useState, type CSSProperties, type FormEvent, type RefObject } from 'react'
import { t } from '../../../shared/i18n'
import type { AddressTagSummary } from '../api/address-tag-api-client'
import { normalizeTagInput } from '../model/addressTagFilter'
import { AnchoredPopover } from './AnchoredPopover'

type RowState = { tag: string; mode: 'rename' | 'delete' } | null

/** 从「管理标签」按钮长出的面板：行内重命名，删除需在行内再确认一次。 */
export function TagManagerPopover({
  open,
  anchorRef,
  tags,
  busy,
  onClose,
  onRename,
  onDelete,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  tags: AddressTagSummary[]
  busy: boolean
  onClose: () => void
  onRename: (from: string, to: string) => Promise<boolean>
  onDelete: (tag: string) => Promise<boolean>
}) {
  const [row, setRow] = useState<RowState>(null)
  const [name, setName] = useState('')
  const next = normalizeTagInput(name)

  async function rename(event: FormEvent) {
    event.preventDefault()
    if (!row || !next) return
    if (next === row.tag || await onRename(row.tag, next)) setRow(null)
  }

  return (
    <AnchoredPopover open={open} anchorRef={anchorRef} onClose={onClose} align="end" label={t('管理标签')} className="tag-manager">
      <header className="tag-manager__header">
        <strong>{t('管理标签')}</strong>
        <small>{t('共 {count} 个', { count: tags.length })}</small>
      </header>
      {tags.length ? (
        <ul className="tag-manager__list">
          {tags.map((tag, index) => {
            const state = row?.tag === tag.name ? row.mode : 'idle'
            return (
              <li key={tag.name} data-state={state} data-stagger="" style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                {state === 'rename' ? (
                  <form className="tag-manager__rename" onSubmit={rename}>
                    <input
                      value={name}
                      maxLength={64}
                      autoFocus
                      aria-label={t('“{tag}”的新名称', { tag: tag.name })}
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return
                        event.stopPropagation()
                        setRow(null)
                      }}
                    />
                    <button className="tag-icon-button is-primary" type="submit" disabled={busy || !next} aria-label={t('保存')}>
                      <Check size={14} aria-hidden="true" />
                    </button>
                    <button className="tag-icon-button" type="button" aria-label={t('取消')} onClick={() => setRow(null)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </form>
                ) : state === 'delete' ? (
                  <span className="tag-manager__confirm" role="alert">
                    <span>{t('从 {count} 个地址上移除“{tag}”？', { count: tag.count, tag: tag.name })}</span>
                    <button className="tag-text-button" type="button" disabled={busy} autoFocus onClick={() => setRow(null)}>{t('取消')}</button>
                    <button
                      className="tag-text-button is-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void onDelete(tag.name).then((deleted) => deleted && setRow(null))}
                    >
                      {t('删除')}
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="tag-chip is-static"><span className="tag-chip__label">{tag.name}</span></span>
                    <small className="tag-manager__count">{t('{count} 个地址', { count: tag.count })}</small>
                    <button
                      className="tag-icon-button"
                      type="button"
                      disabled={busy}
                      aria-label={t('重命名 {tag}', { tag: tag.name })}
                      data-tooltip={t('重命名')}
                      onClick={() => {
                        setRow({ tag: tag.name, mode: 'rename' })
                        setName(tag.name)
                      }}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button
                      className="tag-icon-button is-danger"
                      type="button"
                      disabled={busy}
                      aria-label={t('删除 {tag}', { tag: tag.name })}
                      data-tooltip={t('删除')}
                      onClick={() => setRow({ tag: tag.name, mode: 'delete' })}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : <p className="tag-manager__empty">{t('还没有标签。在地址行末点“+”即可创建。')}</p>}
      <p className="tag-manager__hint">{t('重命名为已有的名字会合并两个标签；删除只移除标签，不影响地址和邮件。')}</p>
    </AnchoredPopover>
  )
}
