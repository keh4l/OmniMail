import { Check, Pencil, Settings2, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../../../shared/i18n'
import { DangerConfirmDialog } from '../../../shared/ui/dialogs/DangerConfirmDialog'
import type { AddressTagSummary } from '../api/address-tag-api-client'
import { normalizeTagInput } from '../model/addressTagFilter'

export function AddressTagManager({
  tags,
  busy,
  onRename,
  onDelete,
  onClose,
}: {
  tags: AddressTagSummary[]
  busy: boolean
  onRename: (from: string, to: string) => Promise<boolean>
  onDelete: (tag: string) => Promise<boolean>
  onClose: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<AddressTagSummary | null>(null)
  const next = normalizeTagInput(name)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editing || !next) return
    if (next === editing || await onRename(editing, next)) setEditing(null)
  }

  return (
    <section className="admin-card address-tags-manager" aria-label={t('管理标签')}>
      <header>
        <Settings2 size={17} />
        <div>
          <h2>{t('管理标签')}</h2>
          <p>{t('重命名会同步到所有使用该标签的地址；改成已有的名字会合并两个标签。')}</p>
        </div>
        <button className="icon-button icon-button--small" type="button" aria-label={t('关闭')} onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      {tags.length ? (
        <ul className="address-tags-manager__list">
          {tags.map((tag) => (
            <li key={tag.name}>
              {editing === tag.name ? (
                <form className="address-tags-manager__rename" onSubmit={save}>
                  <input
                    value={name}
                    maxLength={64}
                    autoFocus
                    aria-label={t('新标签名称')}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button className="button button--small button--primary" type="submit" disabled={busy || !next}>
                    <Check size={14} />{t('保存')}
                  </button>
                  <button className="button button--small button--secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>
                    {t('取消')}
                  </button>
                </form>
              ) : (
                <>
                  <span className="address-tag-chip"><span>{tag.name}</span></span>
                  <small>{t('{count} 个地址', { count: tag.count })}</small>
                  <span className="address-tags-manager__actions">
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      disabled={busy}
                      aria-label={t('重命名 {tag}', { tag: tag.name })}
                      data-tooltip={t('重命名')}
                      onClick={() => {
                        setEditing(tag.name)
                        setName(tag.name)
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button icon-button--small icon-button--danger"
                      type="button"
                      disabled={busy}
                      aria-label={t('删除 {tag}', { tag: tag.name })}
                      data-tooltip={t('删除')}
                      onClick={() => setDeleting(tag)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="address-tags-hint">{t('还没有标签。在下方地址列表里输入标签名称即可创建。')}</p>}
      {deleting && (
        <DangerConfirmDialog
          icon={Trash2}
          eyebrow="DELETE TAG"
          title={t('删除标签')}
          description={t('确认删除标签“{tag}”吗？', { tag: deleting.name })}
          impactTitle={t('将从 {count} 个地址上移除', { count: deleting.count })}
          impactDescription={t('地址本身和邮件都不受影响，只会移除这个标签。')}
          confirmLabel={t('删除标签')}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void onDelete(deleting.name).then((deleted) => {
              if (deleted) setDeleting(null)
            })
          }}
        />
      )}
    </section>
  )
}
