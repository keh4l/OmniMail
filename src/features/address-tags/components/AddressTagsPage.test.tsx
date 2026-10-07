import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AddressTagEntry } from '../api/address-tag-api-client'
import { emptyAddressTagFilters } from '../model/addressTagFilter'
import { AddressTagFiltersBar } from './AddressTagFilters'
import { AddressTagManager } from './AddressTagManager'
import { AddressTagRow } from './AddressTagRow'
import { AddressTagsPage } from './AddressTagsPage'

const entries: AddressTagEntry[] = [
  { address: 'shop@mine.test', sources: ['omnimail'], isActive: false, tags: ['网站A'] },
  { address: 'alias@icloud.com', sources: ['icloud-hme'], tags: [] },
]
const tags = [{ name: '网站A', count: 1 }, { name: 'GitHub', count: 1 }]

describe('address tags page', () => {
  it('renders the page shell with a loading state before data arrives', () => {
    const html = renderToStaticMarkup(<AddressTagsPage iCloudEnabled={false} />)
    expect(html).toContain('地址标签')
    expect(html).toContain('管理标签')
    expect(html).toContain('正在读取地址…')
    expect(html).toContain('id="address-tag-suggestions"')
  })

  it('shows sources, inactive state and removable tags for an address', () => {
    const html = renderToStaticMarkup(
      <ul><AddressTagRow entry={entries[0]} selected onSelect={() => undefined}
        onSave={async () => true} onCopy={() => undefined} /></ul>,
    )
    expect(html).toContain('shop@mine.test')
    expect(html).toContain('自有域名')
    expect(html).toContain('已停用')
    expect(html).toContain('aria-label="移除标签 网站A"')
    expect(html).toContain('list="address-tag-suggestions"')
    expect(html).toContain('is-selected')
  })

  it('exposes include and exclude tag filters with pressed states', () => {
    const html = renderToStaticMarkup(
      <AddressTagFiltersBar entries={entries} tags={tags}
        filters={{ ...emptyAddressTagFilters, tags: { 网站a: 'exclude', github: 'include' } }}
        onChange={() => undefined} />,
    )
    expect(html).toContain('aria-pressed="mixed"')
    expect(html).toContain('aria-label="网站A：排除"')
    expect(html).toContain('aria-label="GitHub：包含"')
    expect(html).toContain('iCloud 隐藏邮箱')
    expect(html).toContain('清除筛选')
  })

  it('lists tags with usage counts for renaming and deletion', () => {
    const html = renderToStaticMarkup(
      <AddressTagManager tags={tags} busy={false} onRename={async () => true}
        onDelete={async () => true} onClose={() => undefined} />,
    )
    expect(html).toContain('aria-label="重命名 网站A"')
    expect(html).toContain('aria-label="删除 GitHub"')
    expect(html).toContain('1 个地址')
  })
})
