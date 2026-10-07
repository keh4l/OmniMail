import { Inbox, RefreshCw, SearchX, Settings2, Tags } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../../shared/api'
import { t } from '../../../shared/i18n'
import { AdminPageHeader } from '../../admin/shell/AdminPageHeader'
import { addressTagApi, type AddressTagEntry, type AddressTagSource, type AddressTagUpdate } from '../api/address-tag-api-client'
import {
  applyAddressTagUpdates,
  emptyAddressTagFilters,
  filterAddressEntries,
  groupEntriesBySource,
  isStaleEntry,
  mergeHideMyEmailAliases,
  tagKey,
  tagSummaries,
  type AddressGroup,
  type AddressTagFilters,
  type TagFilterState,
} from '../model/addressTagFilter'
import { AddressGroupList } from './AddressGroupList'
import { TAGS_PER_ADDRESS } from './AddressRowTags'
import { SelectionBar } from './SelectionBar'
import { TagFilterBar } from './TagFilterBar'
import { TagManagerPopover } from './TagManagerPopover'
import '../styles/address-tags.css'
import '../styles/address-tags-controls.css'
import '../styles/address-tags-overlays.css'

const BATCH_SIZE = 200
type AliasState = 'idle' | 'loading' | 'ready' | 'partial'

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
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
  const [mode, setMode] = useState<TagFilterState>('include')
  const [collapsed, setCollapsed] = useState<Set<AddressTagSource>>(() => new Set())
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [managerOpen, setManagerOpen] = useState(false)
  const anchor = useRef<string | null>(null)
  const managerButton = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const closeManager = useCallback(() => setManagerOpen(false), [])

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
      setAliases(results.flatMap((result) => (result.status === 'fulfilled' ? result.value.aliases.map((alias) => alias.email) : [])))
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
    const timer = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  // 「/」聚焦搜索；没有在输入时按 Esc 清空选择。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'Escape') {
        setSelected(new Set())
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const all = useMemo(() => mergeHideMyEmailAliases(entries, aliases), [entries, aliases])
  const tags = useMemo(() => tagSummaries(all), [all])
  const visible = useMemo(() => filterAddressEntries(all, filters), [all, filters])
  const groups = useMemo(() => groupEntriesBySource(visible), [visible])
  const chosen = useMemo(() => visible.filter((entry) => selected.has(entry.address)), [visible, selected])
  const removable = useMemo(() => tagSummaries(chosen), [chosen])
  const canClearStale = !iCloudEnabled || aliasState === 'ready'

  function applyUpdates(updates: AddressTagUpdate[]) {
    setEntries((current) => applyAddressTagUpdates(current, updates))
  }

  const saveTags = useCallback(async (address: string, next: string[]) => {
    try {
      const update = await addressTagApi.replace(address, next)
      setEntries((current) => applyAddressTagUpdates(current, [update]))
      return update.tags
    } catch (saveError) {
      setError(errorText(saveError, t('无法保存标签。')))
      return null
    }
  }, [])

  async function applyBulk(bulkMode: 'add' | 'remove', tag: string) {
    // 已不在邮箱里的地址只能移除标签，添加时跳过。
    const addresses = chosen.filter((entry) => bulkMode === 'remove' || !isStaleEntry(entry)).map((entry) => entry.address)
    const skipped = chosen.length - addresses.length
    if (!addresses.length) {
      if (skipped) setError(t('所选地址都已不在邮箱里，不能添加标签。'))
      return
    }
    setBusy(true)
    setError('')
    try {
      for (let index = 0; index < addresses.length; index += BATCH_SIZE) {
        const change = bulkMode === 'add' ? { add: [tag] } : { remove: [tag] }
        applyUpdates((await addressTagApi.batch(addresses.slice(index, index + BATCH_SIZE), change)).addresses)
      }
      setNotice(bulkMode === 'remove'
        ? t('已从 {count} 个地址移除“{tag}”', { count: addresses.length, tag })
        : skipped
          ? t('已给 {count} 个地址加上“{tag}”，跳过 {skipped} 个已不在邮箱里的地址', { count: addresses.length, tag, skipped })
          : t('已给 {count} 个地址加上“{tag}”', { count: addresses.length, tag }))
    } catch (bulkError) {
      setError(errorText(bulkError, t('无法批量更新标签。')))
    } finally {
      setBusy(false)
    }
  }

  async function clearStale(stale: AddressTagEntry[]) {
    setBusy(true)
    setError('')
    try {
      for (let index = 0; index < stale.length; index += BATCH_SIZE) {
        const chunk = stale.slice(index, index + BATCH_SIZE)
        const names = tagSummaries(chunk).map((summary) => summary.name)
        // 单次请求最多移除 20 个标签。
        for (let start = 0; start < names.length; start += TAGS_PER_ADDRESS) {
          const remove = names.slice(start, start + TAGS_PER_ADDRESS)
          applyUpdates((await addressTagApi.batch(chunk.map((entry) => entry.address), { remove })).addresses)
        }
      }
      setSelected((current) => new Set([...current].filter((address) => !stale.some((entry) => entry.address === address))))
      setNotice(t('已清理 {count} 个地址的标签', { count: stale.length }))
      return true
    } catch (clearError) {
      setError(errorText(clearError, t('无法清理标签。')))
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

  // Shift 点击从上一次点击的地址选到当前地址（按当前显示顺序）。
  const select = useCallback((address: string, checked: boolean, range: boolean) => {
    const order = groups.flatMap((group) => (collapsed.has(group.source) ? [] : group.entries.map((entry) => entry.address)))
    const from = anchor.current ? order.indexOf(anchor.current) : -1
    const to = order.indexOf(address)
    const targets = range && from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [address]
    anchor.current = address
    setSelected((current) => {
      const next = new Set(current)
      for (const target of targets) {
        if (checked) next.add(target)
        else next.delete(target)
      }
      return next
    })
  }, [groups, collapsed])

  function selectGroup(group: AddressGroup, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const entry of group.entries) {
        if (checked) next.add(entry.address)
        else next.delete(entry.address)
      }
      return next
    })
  }

  function toggleGroup(source: AddressTagSource) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

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
            <button
              ref={managerButton}
              className="button button--secondary"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={managerOpen}
              onClick={() => setManagerOpen((open) => !open)}
            >
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
      {error && (
        <p className="tag-alert" role="alert">
          {error}
          <button type="button" aria-label={t('关闭')} onClick={() => setError('')}>×</button>
        </p>
      )}
      <section className="admin-card tag-card" aria-busy={loading}>
        <TagFilterBar
          entries={all}
          tags={tags}
          filters={filters}
          mode={mode}
          resultCount={visible.length}
          searchRef={searchRef}
          onChange={setFilters}
          onModeChange={setMode}
        />
        {aliasState !== 'idle' && aliasState !== 'ready' && (
          <p className="tag-card__status" data-state={aliasState}>
            {aliasState === 'loading' ? t('正在读取 iCloud 隐藏邮箱…') : t('部分 iCloud 隐藏邮箱暂时无法读取')}
          </p>
        )}
        {loading && !all.length ? (
          <ul className="tag-skeleton" aria-label={t('正在读取地址…')}>
            {Array.from({ length: 6 }, (_, index) => <li key={index} style={{ animationDelay: `${index * 80}ms` }} />)}
          </ul>
        ) : groups.length ? (
          <AddressGroupList
            groups={groups}
            collapsed={collapsed}
            selected={selected}
            suggestions={tags}
            onToggleGroup={toggleGroup}
            onSelect={select}
            onSelectGroup={selectGroup}
            onSave={saveTags}
            canClearStale={canClearStale}
            onClearStale={clearStale}
          />
        ) : (
          <div className="tag-empty">
            {all.length ? <SearchX size={28} aria-hidden="true" /> : <Inbox size={28} aria-hidden="true" />}
            <strong>{all.length ? t('没有符合条件的地址') : t('还没有可以打标签的地址')}</strong>
            <span>{all.length ? t('换个条件试试，或清除筛选。') : t('先创建邮箱地址或接入外部邮箱。')}</span>
          </div>
        )}
      </section>
      <SelectionBar
        count={chosen.length}
        suggestions={tags}
        removable={removable}
        busy={busy}
        onApply={(bulkMode, tag) => void applyBulk(bulkMode, tag)}
        onClear={() => setSelected(new Set())}
      />
      <TagManagerPopover
        open={managerOpen}
        anchorRef={managerButton}
        tags={tags}
        busy={busy}
        onClose={closeManager}
        onRename={(from, to) => changeTag(() => addressTagApi.rename(from, to), from, to, t('标签已重命名'))}
        onDelete={(tag) => changeTag(() => addressTagApi.remove(tag), tag, null, t('标签已删除'))}
      />
      <p className="tag-toast" role="status" data-open={Boolean(notice)} data-lifted={chosen.length > 0}>{notice}</p>
    </main>
  )
}
