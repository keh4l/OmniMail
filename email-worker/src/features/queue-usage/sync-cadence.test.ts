import { describe, expect, it, vi } from 'vitest'
import { d1, insert, migratedDatabase } from '../../../test-support/sqlite-d1'
import {
  isQuietMailbox,
  QUIET_AFTER_SECONDS,
  QUIET_SYNC_INTERVAL_SECONDS,
  relaxQuietSyncInterval,
  shouldRetrySyncJob,
} from './sync-cadence'

const NOW = 2_000_000_000
const DAY = 86_400
const SCHEDULED = NOW + 300

function setup() {
  const db = migratedDatabase()
  insert(db, 'users', { id: 'owner', email: 'owner@example.com' })
  const microsoft = (id: string, nextSyncAt = SCHEDULED, status = 'active') => insert(db, 'microsoft_imap_accounts', {
    id, user_id: 'owner', name: id, provided_email: `${id}@outlook.com`, normalized_email: `${id}@outlook.com`,
    auth_mode: 'oauth2', client_id: 'client', refresh_token_cipher: 'cipher', status, next_sync_at: nextSyncAt,
    created_at: 1, updated_at: 1,
  })
  const folders = new Set<string>()
  const microsoftMail = (accountId: string, receivedAt: number, folderPath = 'Inbox') => {
    if (!folders.has(`${accountId}/${folderPath}`)) {
      folders.add(`${accountId}/${folderPath}`)
      insert(db, 'microsoft_imap_folders', {
        account_id: accountId, path: folderPath, display_name: folderPath, last_listed_at: 1,
      })
    }
    insert(db, 'microsoft_imap_messages', {
      id: crypto.randomUUID(), account_id: accountId, folder_path: folderPath, uid_validity: 1,
      imap_uid: Math.floor(Math.random() * 1e9) + 1, received_at: receivedAt, created_at: 1, updated_at: 1,
    })
  }
  const gmail = (id: string) => insert(db, 'gmail_imap_accounts', {
    id, user_id: 'owner', status: 'active', next_sync_at: SCHEDULED, created_at: 1, updated_at: 1,
  })
  const nextSyncAt = (table: string, id: string) => (
    db.prepare(`SELECT next_sync_at FROM ${table} WHERE id = ?`).get(id) as { next_sync_at: number }
  ).next_sync_at
  return { db, DB: d1(db) as unknown as D1Database, microsoft, microsoftMail, gmail, nextSyncAt }
}

describe('scheduled sync retries', () => {
  it('leaves failed scheduled syncs to the next scheduled run', () => {
    expect(shouldRetrySyncJob('scheduled', 1, true)).toBe(false)
    expect(shouldRetrySyncJob('manual', 1, true)).toBe(true)
    expect(shouldRetrySyncJob('connect', 2, true)).toBe(true)
    expect(shouldRetrySyncJob('manual', 3, true)).toBe(false)
    expect(shouldRetrySyncJob('manual', 1, false)).toBe(false)
  })
})

describe('quiet mailbox detection', () => {
  it('treats mailboxes without mail in the last 7 days as quiet', () => {
    expect(isQuietMailbox(null, NOW)).toBe(true)
    expect(isQuietMailbox(NOW - QUIET_AFTER_SECONDS, NOW)).toBe(true)
    expect(isQuietMailbox(NOW - QUIET_AFTER_SECONDS + 1, NOW)).toBe(false)
    expect(isQuietMailbox(NOW - 60, NOW)).toBe(false)
  })
})

describe('relaxQuietSyncInterval', () => {
  it('postpones the next sync of a quiet Microsoft inbox to 30 minutes', async () => {
    const { DB, microsoft, microsoftMail, nextSyncAt } = setup()
    microsoft('quiet')
    microsoftMail('quiet', NOW - 30 * DAY)
    // 其他文件夹里的新信不算收件箱活跃。
    microsoftMail('quiet', NOW - 60, 'Junk')

    await relaxQuietSyncInterval(DB, { provider: 'microsoft', accountId: 'quiet', folderPath: 'Inbox' }, NOW, SCHEDULED)
    expect(nextSyncAt('microsoft_imap_accounts', 'quiet')).toBe(NOW + QUIET_SYNC_INTERVAL_SECONDS)
  })

  it('keeps the normal interval for an inbox with recent mail', async () => {
    const { DB, microsoft, microsoftMail, nextSyncAt } = setup()
    microsoft('busy')
    microsoftMail('busy', NOW - 30 * DAY)
    microsoftMail('busy', NOW - 2 * DAY)

    await relaxQuietSyncInterval(DB, { provider: 'microsoft', accountId: 'busy', folderPath: 'Inbox' }, NOW, SCHEDULED)
    expect(nextSyncAt('microsoft_imap_accounts', 'busy')).toBe(SCHEDULED)
  })

  it('does not overwrite a schedule that changed after the sync finished', async () => {
    const { DB, microsoft, nextSyncAt } = setup()
    microsoft('verified', 0)

    await relaxQuietSyncInterval(DB, { provider: 'microsoft', accountId: 'verified', folderPath: 'Inbox' }, NOW, SCHEDULED)
    expect(nextSyncAt('microsoft_imap_accounts', 'verified')).toBe(0)
  })

  it('handles Gmail accounts, including an empty inbox', async () => {
    const { db, DB, gmail, nextSyncAt } = setup()
    gmail('empty')
    gmail('busy')
    insert(db, 'gmail_imap_messages', {
      id: 'g1', account_id: 'busy', uid_validity: 1, imap_uid: 1, internal_date: NOW - DAY,
      created_at: 1, updated_at: 1,
    })

    await relaxQuietSyncInterval(DB, { provider: 'gmail', accountId: 'empty' }, NOW, SCHEDULED)
    await relaxQuietSyncInterval(DB, { provider: 'gmail', accountId: 'busy' }, NOW, SCHEDULED)
    expect(nextSyncAt('gmail_imap_accounts', 'empty')).toBe(NOW + QUIET_SYNC_INTERVAL_SECONDS)
    expect(nextSyncAt('gmail_imap_accounts', 'busy')).toBe(SCHEDULED)
  })

  it('never fails the sync when the lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const DB = { prepare: () => { throw new Error('D1 unavailable') } } as unknown as D1Database

    await expect(relaxQuietSyncInterval(DB, { provider: 'gmail', accountId: 'g' }, NOW, SCHEDULED))
      .resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'quiet_sync_interval_failed' }))
    warn.mockRestore()
  })
})
