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
    if (path.startsWith('/api/address-tags/') && request.method() === 'PUT') {
      const address = path.slice('/api/address-tags/'.length)
      tags[address] = (request.postDataJSON() as { tags: string[] }).tags
      return fulfill({ address, tags: tags[address] })
    }
    return fulfill({ error: 'Not found' }, 404)
  })

  await page.goto('/settings/address-tags')
  await expect(page.getByRole('heading', { name: '地址标签' })).toBeVisible()
  const rows = page.locator('.address-tags-row')
  await expect(rows).toHaveCount(2)

  await page.getByLabel('为 fresh@example.com 添加标签').fill('网站B')
  await page.getByLabel('为 fresh@example.com 添加标签').press('Enter')
  await expect(rows.filter({ hasText: 'fresh@example.com' }).locator('.address-tag-chip')).toHaveText('网站B')

  const siteA = page.getByRole('group', { name: '按标签筛选' }).getByRole('button', { name: /^网站A：/ })
  await siteA.click()
  await expect(siteA).toHaveAttribute('aria-pressed', 'true')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('shop@example.com')

  await siteA.click()
  await expect(siteA).toHaveAttribute('aria-pressed', 'mixed')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('fresh@example.com')

  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(rows).toHaveCount(2)
})
