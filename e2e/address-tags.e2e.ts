import { expect, test } from '@playwright/test'
import { user } from './omnimail-fixtures'

test('address tags find addresses that have not registered on a site', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('omnimail.deployment-guide.v1', 'seen')
    localStorage.setItem('omnimail-locale', 'zh-CN')
  })
  const tags: Record<string, string[]> = {
    'shop@example.com': ['网站A'],
    'fresh@example.com': [],
  }
  await page.route('**://*/api/**', async (route) => {
    const request = route.request()
    const path = decodeURIComponent(new URL(request.url()).pathname)
    const fulfill = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    })
    if (path === '/api/config') return fulfill({
      appName: 'OmniMail', setupComplete: true, replyEnabled: false,
      registrationEnabled: false, registrationAvailable: false,
      registrationMethod: 'password', linuxDoLoginEnabled: false,
      registrationDomainPolicy: { mode: 'blocklist', domains: [] },
      registrationProtectionReady: false, turnstileSiteKey: '',
      mailRefreshInterval: 0, remoteImagesEnabled: false,
      unassignedMailEnabled: false, officialExtensionEnabled: false,
      randomMailboxPrefix: '', superAdminEmail: user.email,
      setupRequirements: {
        databaseReady: true, storageReady: true, queueReady: true,
        superAdminReady: true, setupTokenReady: false,
      },
    })
    if (path === '/api/session') return fulfill({ user })
    if (path === '/api/mailboxes') return fulfill({ mailboxes: [] })
    if (path === '/api/domains') return fulfill({ domains: [] })
    if (path === '/api/address-tags') return fulfill({
      addresses: Object.entries(tags).map(([address, list]) => ({
        address, sources: ['omnimail'], isActive: true, tags: list,
      })),
      tags: [],
    })
    if (path === '/api/address-tags/batch') {
      const body = request.postDataJSON() as { addresses: string[]; add?: string[] }
      for (const address of body.addresses) tags[address] = [...tags[address], ...(body.add ?? [])]
      return fulfill({ addresses: body.addresses.map((address) => ({ address, tags: tags[address] })) })
    }
    if (path.startsWith('/api/address-tags/') && request.method() === 'PUT') {
      const address = path.slice('/api/address-tags/'.length)
      tags[address] = (request.postDataJSON() as { tags: string[] }).tags
      return fulfill({ address, tags: tags[address] })
    }
    return fulfill({ error: 'Not found' }, 404)
  })

  await page.goto('/settings/address-tags')
  await expect(page.getByRole('heading', { name: '地址标签' })).toBeVisible()
  const rows = page.locator('.tag-row')
  await expect(rows).toHaveCount(2)
  const freshRow = rows.filter({ hasText: 'fresh' })

  // 行内添加：点「+ 添加标签」展开输入框，回车创建新标签。
  await freshRow.getByRole('button', { name: '为 fresh@example.com 添加标签' }).click()
  const input = freshRow.getByRole('combobox', { name: '为 fresh@example.com 添加标签' })
  await input.fill('网站B')
  await expect(freshRow.getByRole('option', { name: '创建“网站B”' })).toBeVisible()
  await input.press('Enter')
  await expect(freshRow.locator('.tag-chip')).toHaveText('网站B')
  await input.press('Escape')

  // 排除模式：点「网站A」只留下没有注册过网站A的地址。
  const chips = page.getByRole('group', { name: '按标签筛选' })
  await page.getByRole('radio', { name: '排除' }).click()
  await chips.getByRole('button', { name: '网站A', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('fresh')
  await expect(page.locator('.tag-condition')).toHaveText('没有“网站A”')

  // 切回包含模式再点同一个标签，条件改为「有网站A」。
  await page.getByRole('radio', { name: '包含' }).click()
  await chips.getByRole('button', { name: '网站A：排除' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('shop')

  await page.getByRole('button', { name: '清除全部' }).click()
  await expect(rows).toHaveCount(2)

  // 批量：勾选后底部升起操作栏，输入标签回车加到所选地址。
  await rows.filter({ hasText: 'shop' }).getByRole('checkbox').check()
  const bar = page.getByRole('region', { name: '批量编辑标签' })
  await expect(bar).toContainText('1')
  await bar.getByRole('combobox', { name: '给所选地址添加标签' }).fill('GPT')
  await bar.getByRole('combobox', { name: '给所选地址添加标签' }).press('Enter')
  await expect(rows.filter({ hasText: 'shop' }).locator('.tag-chip')).toHaveText(['网站A', 'GPT'])
  await expect(page.locator('.tag-toast')).toHaveText('已给 1 个地址加上“GPT”')
})
