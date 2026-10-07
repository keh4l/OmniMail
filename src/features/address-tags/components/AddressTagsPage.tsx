import { LoaderCircle, Plus, RefreshCw, Settings2, Tags } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../../shared/api'
import { t } from '../../../shared/i18n'
import { AdminPageHeader } from '../../admin/shell/AdminPageHeader'
import { addressTagApi, type AddressTagEntry, type AddressTagUpdate } from '../api/address-tag-api-client'
import {
  applyAddressTagUpdates,
  emptyAddressTagFilters,
  filterAddressEntries,
  mergeHideMyEmailAliases,
  tagKey,
  tagSummaries,
  type AddressTagFilters,
} from '../model/addressTagFilter'
import { AddressTagBulkBar } from './AddressTagBulkBar'
import { AddressTagFiltersBar } from './AddressTagFilters'
import { AddressTagManager } from './AddressTagManager'
import { ADDRESS_TAG_SUGGESTIONS_ID, AddressTagRow } from './AddressTagRow'
import '../styles/address-tags.css'

const BATCH_SIZE = 200
type AliasState = 'idle' | 'loading' | 'ready' | 'partial'

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function manualAddress(query: string): string {
  const address = query.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254 ? address : ''
}

export function AddressTagsPage({ iCloudEnabled }: { iCloudEnabled: boolean }) {
  const [entries, setEntries] = useState<AddressTagEntry[]>([])
  const [aliases, setAliases] = useState<string[]>([])
  const [aliasState, setAliasState] = useState<AliasState>('idle')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<AddressTagFilters>(emptyAddressTagFilters)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [managerOpen, setManagerOpen] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setEntries((await addressTagApi.list(signal)).addresses)
    } catch (loadError) {
      if (!signal?.aborted) setError(errorText(loadError, t('无法读取地址标签。')))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  // iCloud 隐藏邮箱只能实时向 Apple 读取，单独加载，失败时不影响其他地址。
  const loadAliases = useCallback(async (signal?: AbortSignal) => {
    if (!iCloudEnabled) return
    setAliasState('loading')
    try {
      const { accounts } = await api.iCloudAccounts(signal)
      const results = await Promise.allSettled(
        accounts.filter((account) => account.hasCookies).map((account) => api.iCloudAliases(account.id, signal)),
      )
      if (signal?.aborted) return
      setAliases(results.flatMap((result) => (
        result.status === 'fulfilled' ? result.value.aliases.map((alias) => alias.email) : []
      )))
      setAliasState(results.some((result) => result.status === 'rejected') ? 'partial' : 'ready')
    } catch {
      if (!signal?.aborted) setAliasState('partial')
    }
  }, [iCloudEnabled])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    void loadAliases(controller.signal)
    return () => controller.abort()
  }, [load, loadAliases])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const all = useMemo(() => mergeHideMyEmailAliases(entries, aliases), [entries, aliases])
  const tags = useMemo(() => tagSummaries(all), [all])
  const visible = useMemo(() => filterAddressEntries(all, filters), [all, filters])
  const chosen = visible.filter((entry) => selected.has(entry.address)).map((entry) => entry.address)
  const candidate = manualAddress(filters.query)
  const canAddCandidate = Boolean(candidate) && !all.some((entry) => entry.address === candidate)

  function applyUpdates(updates: AddressTagUpdate[]) {
    setEntries((current) => applyAddressTagUpdates(current, updates))
  }

  async function saveTags(address: string, next: string[]): Promise<boolean> {
    try {
      applyUpdates([await addressTagApi.replace(address, next)])
      return true
    } catch (saveError) {
      setError(errorText(saveError, t('无法保存标签。')))
      return false
    }
  }

  async function bulkUpdate(change: { add?: string[]; remove?: string[] }): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      for (let index = 0; index < chosen.length; index += BATCH_SIZE) {
        applyUpdates((await addressTagApi.batch(chosen.slice(index, index + BATCH_SIZE), change)).addresses)
      }
      setNotice(t('已更新 {count} 个地址的标签', { count: chosen.length }))
      setSelected(new Set())
      return true
    } catch (bulkError) {
      setError(errorText(bulkError, t('无法批量更新标签。')))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function changeTag(operation: () => Promise<unknown>, from: string, to: string | null, message: string) {
    setBusy(true)
    setError('')
    try {
      await operation()
      setFilters((current) => {
        const state = current.tags[tagKey(from)]
        if (!state) return current
        const rules = { ...current.tags }
        delete rules[tagKey(from)]
        if (to) rules[tagKey(to)] = state
        return { ...current, tags: rules }
      })
      await load()
      setNotice(message)
      return true
    } catch (tagError) {
      setError(errorText(tagError, t('无法更新标签。')))
      return false
    } finally {
      setBusy(false)
    }
  }

  function select(address: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(address)
      else next.delete(address)
      return next
    })
  }

  const allVisibleSelected = visible.length > 0 && chosen.length === visible.length

  return (
    <main className="admin-workspace address-tags-workspace">
      <AdminPageHeader
        icon={Tags}
        eyebrow="ADDRESSES · TAGS"
        title={t('地址标签')}
        description={t('给邮箱地址标记注册过的网站，再按标签筛选或排除。标签只有你自己能看到。')}
        className="address-tags__header"
        actions={(
          <div className="user-header-actions">
            <button className="button button--secondary" type="button" aria-expanded={managerOpen} onClick={() => setManagerOpen((open) => !open)}>
              <Settings2 size={16} />{t('管理标签')}
            </button>
            <button className="button button--secondary" type="button" disabled={loading} onClick={() => {
              void load()
              void loadAliases()
            }}>
              <RefreshCw size={16} className={loading ? 'spin' : undefined} />{t('刷新')}
            </button>
          </div>
        )}
      />
      {error && <p className="address-tags-feedback is-error" role="alert">{error}</p>}
      {notice && <p className="address-tags-feedback" role="status">{notice}</p>}
      {managerOpen && (
        <AddressTagManager
          tags={tags}
          busy={busy}
          onRename={(from, to) => changeTag(() => addressTagApi.rename(from, to), from, to, t('标签已重命名'))}
          onDelete={(tag) => changeTag(() => addressTagApi.remove(tag), tag, null, t('标签已删除'))}
          onClose={() => setManagerOpen(false)}
        />
      )}
      <section className="admin-card address-tags-card" aria-busy={loading}>
        <AddressTagFiltersBar entries={all} tags={tags} filters={filters} onChange={setFilters} />
        {chosen.length > 0 && (
          <AddressTagBulkBar count={chosen.length} busy={busy} onApply={bulkUpdate} onClear={() => setSelected(new Set())} />
        )}
        <div className="address-tags-list-head">
          <label className="address-tags-check">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={!visible.length}
              onChange={(event) => setSelected(event.target.checked ? new Set(visible.map((entry) => entry.address)) : new Set())}
            />
            <span>{t('全选')}</span>
          </label>
          <span>{t('显示 {shown} / {total} 个地址', { shown: visible.length, total: all.length })}</span>
          {aliasState === 'loading' && (
            <span className="address-tags-hint"><LoaderCircle className="spin" size={13} />{t('正在读取 iCloud 隐藏邮箱…')}</span>
          )}
          {aliasState === 'partial' && (
            <span className="address-tags-hint is-warning">{t('部分 iCloud 隐藏邮箱暂时无法读取')}</span>
          )}
        </div>
        {loading && !all.length ? (
          <div className="address-tags-empty" role="status"><LoaderCircle className="spin" size={18} />{t('正在读取地址…')}</div>
        ) : visible.length ? (
          <ul className="address-tags-list">
            {visible.map((entry) => (
              <AddressTagRow
                key={entry.address}
                entry={entry}
                selected={selected.has(entry.address)}
                onSelect={select}
                onSave={saveTags}
                onCopy={(address) => {
                  void navigator.clipboard?.writeText(address).then(() => setNotice(t('已复制：{address}', { address })))
                }}
              />
            ))}
          </ul>
        ) : (
          <div className="address-tags-empty">
            <span>{all.length ? t('没有符合筛选条件的地址。') : t('还没有可以打标签的地址。先创建邮箱地址或接入外部邮箱。')}</span>
            {canAddCandidate && (
              <button className="button button--small button--secondary" type="button" onClick={() => {
                applyUpdates([{ address: candidate, tags: [] }])
                setFilters({ ...emptyAddressTagFilters, query: candidate })
              }}>
                <Plus size={14} />{t('把 {address} 加入列表', { address: candidate })}
              </button>
            )}
          </div>
        )}
      </section>
      <datalist id={ADDRESS_TAG_SUGGESTIONS_ID}>
        {tags.map((tag) => <option key={tag.name} value={tag.name} />)}
      </datalist>
    </main>
  )
}
