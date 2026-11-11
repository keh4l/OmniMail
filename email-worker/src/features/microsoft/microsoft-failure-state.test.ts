import { describe, expect, it } from 'vitest'
import { microsoftFailureState } from './microsoft-failure-state'

const now = 2_000_000_000
const hour = 60 * 60

describe('Microsoft sync failure state', () => {
  it('retries an occasional IMAP rejection soon when the account synced recently', () => {
    expect(microsoftFailureState('imap_access_rejected', now - 10 * 60, now))
      .toEqual({ status: 'error', nextSyncAt: now + 15 * 60 })
    expect(microsoftFailureState('imap_access_rejected', now - 23 * hour, now))
      .toEqual({ status: 'error', nextSyncAt: now + 15 * 60 })
  })

  it('marks a persistent IMAP rejection as a permission problem and retries daily', () => {
    expect(microsoftFailureState('imap_access_rejected', now - 24 * hour, now))
      .toEqual({ status: 'permission_error', nextSyncAt: now + 24 * hour })
    expect(microsoftFailureState('imap_access_rejected', null, now))
      .toEqual({ status: 'permission_error', nextSyncAt: now + 24 * hour })
    expect(microsoftFailureState('imap_access_rejected', undefined, now).status)
      .toBe('permission_error')
  })

  it('keeps other permission and credential failures out of the grace period', () => {
    expect(microsoftFailureState('imap_scope_missing', now - 60, now).status).toBe('permission_error')
    expect(microsoftFailureState('invalid_grant', now - 60, now))
      .toEqual({ status: 'credential_error', nextSyncAt: now + 24 * hour })
    expect(microsoftFailureState('credential_decryption_failed', now - 60, now).status)
      .toBe('credential_error')
  })

  it('treats unknown and network failures as ordinary errors', () => {
    expect(microsoftFailureState('timeout', now - 60, now))
      .toEqual({ status: 'error', nextSyncAt: now + 5 * 60 })
    expect(microsoftFailureState('sync_failed', null, now).status).toBe('error')
  })
})
