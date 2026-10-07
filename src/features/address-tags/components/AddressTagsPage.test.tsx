import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AddressTagEntry } from '../api/address-tag-api-client'
import { emptyAddressTagFilters, groupEntriesBySource } from '../model/addressTagFilter'
import { AddressGroupList } from './AddressGroupList'
import { AddressTagsPage } from './AddressTagsPage'
import { TagFilterBar } from './TagFilterBar'
import { tagOptions } from './TagSuggestInput'

const entries: AddressTagEntry[] = [
  { address: 'shop@mine.test', sources: ['omnimail'], isActive: false, tags: ['GPT'] },
  { address: 'a1@outlook.com', sources: ['microsoft'], tags: [] },
]
const tags = [{ name: 'GPT', count: 3 }, { name: 'Claude', count: 1 }, { name: 'GitHub', count: 2 }]

describe('address tags page', () => {
  it('renders the page shell with skeleton rows before data arrives', () => {
    const html = renderToStaticMarkup(<AddressTagsPage iCloudEnabled={false} />)
    expect(html).toContain('地址标签')
    expect(html).toContain('管理标签')
    expect(html).toContain('tag-skeleton')
    expect(html).toContain('data-open="false"')
  })

  it('switches between include and exclude modes and summarises active conditions', () => {
    const html = renderToStaticMarkup(
      <TagFilterBar entries={entries} tags={tags} mode="exclude" resultCount={1}
        filters={{ ...emptyAddressTagFilters, tags: { gpt: 'include', claude: 'exclude' } }}
        searchRef={createRef()} onChange={() => undefined} onModeChange={() => undefined} />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('data-mode="exclude"')
    expect(html).toMatch(/data-state="include"[^>]*aria-label="GPT：包含"/)
    expect(html).toMatch(/data-state="exclude"[^>]*aria-label="Claude：排除"/)
    expect(html).toContain('显示 1 个地址')
    expect(html).toContain('有“GPT”')
    expect(html).toContain('没有“Claude”')
  })

  it('groups rows by source with a compact address and an add-tag affordance', () => {
    const html = renderToStaticMarkup(
      <AddressGroupList groups={groupEntriesBySource(entries)} collapsed={new Set(['microsoft'])}
        selected={new Set(['shop@mine.test'])} suggestions={tags} onToggleGroup={() => undefined}
        onSelect={() => undefined} onSelectGroup={() => undefined} onSave={async () => []} />,
    )
    expect(html).toContain('自有域名')
    expect(html).toContain('Microsoft')
    expect(html).toContain('<span class="tag-row__domain">@mine.test</span>')
    expect(html).toContain('已停用')
    expect(html).toContain('aria-label="复制 shop@mine.test"')
    expect(html).toContain('aria-label="移除标签 GPT"')
    expect(html).toContain('aria-label="为 a1@outlook.com 添加标签"')
    expect(html).toMatch(/data-collapsed="true"/)
    expect(html).toContain('data-selecting="true"')
  })
})

describe('tag suggestions', () => {
  it('prefers prefix matches, hides existing tags and offers to create new ones', () => {
    expect(tagOptions('g', tags, []).map((option) => option.tag)).toEqual(['GPT', 'GitHub', 'g'])
    expect(tagOptions('g', tags, ['gpt']).map((option) => option.tag)).toEqual(['GitHub', 'g'])
    expect(tagOptions('gpt', tags, []).some((option) => option.create)).toBe(false)
    expect(tagOptions('网站A', tags, []).at(-1)).toEqual({ id: 'create', tag: '网站A', create: true })
    expect(tagOptions('新', tags, [], false)).toEqual([])
  })
})
