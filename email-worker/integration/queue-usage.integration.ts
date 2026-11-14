import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import type { Env, MailQueueJob } from '../src/app/types'
import {
  BACKGROUND_OPERATION_BUDGET,
  claimBackgroundOperations,
  purgeOldQueueUsage,
  queueOperationsUsed,
  usageKey,
} from '../src/features/queue-usage/queue-usage'
import { QUEUE_FAILURE_PREFIX, requeueQueueFailures } from '../src/features/queue-usage/queue-recovery'
import { QUIET_SYNC_INTERVAL_SECONDS, relaxQuietSyncInterval } from '../src/features/queue-usage/sync-cadence'

const db = () => env.DB as D1Database

async function setUsage(value: number | null): Promise<void> {
  await db().prepare("DELETE FROM settings WHERE key LIKE 'queue_operations:%'").run()
  if (value !== null) {
    await db().prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)')
      .bind(usageKey(Date.now()), String(value)).run()
  }
}

async function insertMicrosoftAccount(id: string, nextSyncAt: number): Promise<void> {
  await db().prepare(
    `INSERT INTO microsoft_imap_accounts(
       id, user_id, name, provided_email, normalized_email, auth_mode, client_id,
       refresh_token_cipher, status, next_sync_at, created_at, updated_at
     ) VALUES (?, 'queue-owner', ?, ?, ?, 'oauth2', 'test', 'cipher', 'active', ?, 1, 1)`,
  ).bind(id, id, `${id}@outlook.com`, `${id}@outlook.com`, nextSyncAt).run()
}

function scheduledEnvironment() {
  const sent: MailQueueJob[] = []
  const testEnv = {
    ...env,
    MAIL_QUEUE: { send: async (job: MailQueueJob) => { sent.push(job) } },
    CLEANUP_WORKFLOW: { create: async () => ({ id: 'cleanup' }) },
  } as unknown as Env
  return { sent, testEnv }
}

async function runScheduled(testEnv: Env): Promise<void> {
  await worker.scheduled(
    { cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry() {} } as ScheduledController,
    testEnv,
  )
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await db().prepare(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES('queue-owner','queue@example.com','Queue','test')",
  ).run()
  await db().prepare("INSERT INTO mailboxes(address,user_id) VALUES('queue@example.com','queue-owner')").run()
})

beforeEach(async () => {
  await setUsage(null)
  await db().prepare('DELETE FROM microsoft_imap_accounts').run()
})

describe('queue usage counters on D1', () => {
  it('claims background operations atomically and purges old days', async () => {
    const now = Date.now()
    await setUsage(BACKGROUND_OPERATION_BUDGET - 4)
    await expect(claimBackgroundOperations(db(), 3, now)).resolves.toBe(true)
    await expect(claimBackgroundOperations(db(), 3, now)).resolves.toBe(false)
    await expect(queueOperationsUsed(db(), now)).resolves.toBe(BACKGROUND_OPERATION_BUDGET - 1)

    await db().prepare("INSERT INTO settings (key, value, updated_at) VALUES ('queue_operations:2000-01-01', '5', 1)").run()
    await purgeOldQueueUsage(db(), now)
    await expect(db().prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'queue_operations:%'").first())
      .resolves.toEqual({ n: 1 })
  })
})

describe('scheduled handler', () => {
  it('pauses scheduled syncs once the background budget is spent', async () => {
    await insertMicrosoftAccount('budget-account', 0)
    await setUsage(BACKGROUND_OPERATION_BUDGET - 2)
    const blocked = scheduledEnvironment()
    await runScheduled(blocked.testEnv)
    expect(blocked.sent.filter((job) => job.kind === 'microsoft-sync')).toHaveLength(0)
    const due = await db().prepare('SELECT next_sync_at FROM microsoft_imap_accounts WHERE id = ?')
      .bind('budget-account').first<{ next_sync_at: number }>()
    expect(due!.next_sync_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))

    await setUsage(null)
    const allowed = scheduledEnvironment()
    await runScheduled(allowed.testEnv)
    expect(allowed.sent).toContainEqual({ kind: 'microsoft-sync', accountId: 'budget-account', reason: 'scheduled' })
    await expect(queueOperationsUsed(db())).resolves.toBe(3)
  })

  it('requeues mail that failed to enter the queue before running background syncs', async () => {
    await insertMicrosoftAccount('order-account', 0)
    await db().prepare(
      `INSERT INTO messages (id, mailbox_address, direction, status, folder, sender_address,
         recipients_json, body_key, processing_error, last_failed_at)
       VALUES ('queued-later', 'queue@example.com', 'outgoing', 'failed', 'sent', 'queue@example.com',
         '["friend@example.net"]', 'bodies/queued-later.json', ?, unixepoch() - 60)`,
    ).bind(`${QUEUE_FAILURE_PREFIX}limit`).run()
    await db().prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('queue_failure_retry_pending', 'flag', 1)",
    ).run()

    const { sent, testEnv } = scheduledEnvironment()
    await runScheduled(testEnv)
    expect(sent[0]).toMatchObject({ kind: 'outbound', messageId: 'queued-later', userId: 'queue-owner' })
    expect(sent).toContainEqual({ kind: 'microsoft-sync', accountId: 'order-account', reason: 'scheduled' })
    await expect(db().prepare("SELECT status FROM messages WHERE id = 'queued-later'").first())
      .resolves.toEqual({ status: 'processing' })
    await expect(requeueQueueFailures(testEnv)).resolves.toBe(0)
  })
})

describe('quiet sync interval on D1', () => {
  it('uses the inbox index and relaxes only quiet accounts', async () => {
    const now = 2_000_000_000
    await insertMicrosoftAccount('quiet-account', now + 300)
    await relaxQuietSyncInterval(db(), { provider: 'microsoft', accountId: 'quiet-account', folderPath: 'Inbox' }, now, now + 300)
    await expect(db().prepare("SELECT next_sync_at FROM microsoft_imap_accounts WHERE id = 'quiet-account'").first())
      .resolves.toEqual({ next_sync_at: now + QUIET_SYNC_INTERVAL_SECONDS })
  })
})
