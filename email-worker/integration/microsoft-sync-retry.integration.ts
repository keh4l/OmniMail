import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Env, MailQueueJob } from '../src/app/types'
import { enqueueDueMicrosoftSyncs, syncMicrosoftAccount } from '../src/features/microsoft/microsoft-sync'

const NOW = 2_000_000_000

async function insertAccount(id: string, status: string, nextSyncAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO microsoft_imap_accounts(
       id, user_id, name, provided_email, normalized_email, auth_mode, client_id,
       refresh_token_cipher, status, next_sync_at, last_error_code, last_error_at,
       created_at, updated_at
     ) VALUES (?, 'retry-owner', ?, ?, ?, 'oauth2', 'test', 'not-a-valid-cipher', ?, ?, 'imap_access_rejected', 1, 1, 1)`,
  ).bind(id, id, `${id}@outlook.com`, `${id}@outlook.com`, status, nextSyncAt).run()
}

async function accountState(id: string) {
  return env.DB.prepare(
    'SELECT status, last_error_code, last_error_at FROM microsoft_imap_accounts WHERE id = ?',
  ).bind(id).first<{ status: string; last_error_code: string; last_error_at: number | null }>()
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await env.DB.prepare(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES('retry-owner','retry@example.com','Retry','test')",
  ).run()
  await insertAccount('due-active', 'active', NOW - 1)
  await insertAccount('due-error', 'error', NOW - 1)
  await insertAccount('due-permission', 'permission_error', NOW - 1)
  await insertAccount('later-permission', 'permission_error', NOW + 60)
  await insertAccount('due-credential', 'credential_error', NOW - 1)
})

describe('Microsoft sync retries after permission errors', () => {
  it('schedules due permission errors again but leaves credential errors for the user', async () => {
    const sent: MailQueueJob[] = []
    const queueEnv = {
      ...env,
      MAIL_QUEUE: { send: async (job: MailQueueJob) => { sent.push(job) } },
    } as unknown as Env

    await expect(enqueueDueMicrosoftSyncs(queueEnv, NOW)).resolves.toBe(3)
    expect(sent.map((job) => job.kind === 'microsoft-sync' ? job.accountId : '').sort())
      .toEqual(['due-active', 'due-error', 'due-permission'])
  })

  it('lets a scheduled job run for a permission error but not for a credential error', async () => {
    await syncMicrosoftAccount(env as unknown as Env, 'due-permission', NOW)
    await expect(accountState('due-permission')).resolves.toMatchObject({
      status: 'credential_error',
      last_error_code: 'credential_decryption_failed',
      last_error_at: NOW,
    })

    await expect(syncMicrosoftAccount(env as unknown as Env, 'due-credential', NOW))
      .resolves.toEqual({ status: 'skipped', retryable: false })
    await expect(accountState('due-credential')).resolves.toMatchObject({
      status: 'credential_error',
      last_error_at: 1,
    })
  })
})
