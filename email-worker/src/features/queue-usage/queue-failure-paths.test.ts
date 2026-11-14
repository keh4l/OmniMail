import { afterEach, describe, expect, it, vi } from 'vitest'
import { receiveEmail } from '../../app/handlers/mail'
import { retryFailedMessage } from '../messages/failed-mail-api'
import { requeueFailedOutbound, sendOutboundMessage } from '../outbound/outbound-message'
import {
  OUTBOUND_QUEUE_FAILURE_MESSAGE,
  QUEUE_FAILURE_PREFIX,
  RETRY_QUEUE_FAILURE_MESSAGE,
} from './queue-recovery'
import type { Env, SessionUser } from '../../app/types'

// 上游的发信、收信、手动重试在入队失败时都改为调用 recordQueueFailure；这里集中验证这些入口的表现。

vi.mock('../../platform/d1/schema', () => ({ ensureSchema: vi.fn() }))

const QUEUE_ERROR = 'Queue daily operation limit exceeded'

const user = {
  id: 'user-1', email: 'owner@example.com', displayName: 'Owner', role: 'super_admin',
  mailboxLimit: 1, storageQuotaBytes: 1024 ** 3, storageUsedBytes: 0, canCreateMailboxes: true,
  canReply: true, temporaryExpiresAt: null,
} as unknown as SessionUser

function environment(firstResult: (sql: string) => unknown = () => null) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = []
  const prepare = (sql: string) => {
    const entry = { sql, bindings: [] as unknown[] }
    statements.push(entry)
    const statement = {
      bind: (...bindings: unknown[]) => { entry.bindings = bindings; return statement },
      first: async () => firstResult(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    }
    return statement
  }
  const batch = vi.fn(async () => [])
  const send = vi.fn(async () => { throw new Error(QUEUE_ERROR) })
  const bucket = {
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    head: vi.fn(async () => ({ size: 2048 })),
  }
  const env = {
    DB: { prepare, batch },
    MAIL_BUCKET: bucket,
    MAIL_QUEUE: { send },
    SUPER_ADMIN_EMAIL: 'owner@example.com',
  } as unknown as Env
  const markedFailed = () => statements.some(({ sql, bindings }) => (
    sql.includes("SET status = 'failed'") && bindings[0] === `${QUEUE_FAILURE_PREFIX}${QUEUE_ERROR}`
  ))
  const flagged = () => statements.some(({ bindings }) => bindings[0] === 'queue_failure_retry_pending')
  return { env, batch, send, bucket, statements, markedFailed, flagged }
}

afterEach(() => vi.restoreAllMocks())

describe('when the mail queue rejects a job', () => {
  it('a new outgoing message is kept for automatic resend and the sender is told so', async () => {
    const { env, send, markedFailed, flagged } = environment()
    const response = await sendOutboundMessage(env, user, {
      mailboxAddress: 'owner@example.com',
      recipients: ['friend@example.net'],
      subject: 'Hello',
      text: 'Message body',
      idempotencyKey: 'request_queue_full',
      auditAction: 'message.send',
      auditDetail: { recipient: 'friend@example.net' },
    }, '127.0.0.1')

    expect(send).toHaveBeenCalledOnce()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: OUTBOUND_QUEUE_FAILURE_MESSAGE })
    expect(markedFailed()).toBe(true)
    expect(flagged()).toBe(true)
  })

  it('resubmitting a failed message gives the same explanation', async () => {
    const { env, markedFailed } = environment()
    const response = await requeueFailedOutbound(env, 'out-1', user.id, '127.0.0.1', 'message.send', {})

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: OUTBOUND_QUEUE_FAILURE_MESSAGE })
    expect(markedFailed()).toBe(true)
  })

  it('an administrator retry explains the failure and writes no audit entry', async () => {
    const { env, statements, markedFailed } = environment((sql) => sql.includes('SELECT m.id')
      ? {
          id: 'message-1', direction: 'incoming', raw_key: 'raw/message-1.eml', body_key: null,
          in_reply_to: null, recipients_json: '[]', user_id: 'user-1', is_hidden: 0, processing_error: null,
        }
      : null)
    const response = await retryFailedMessage(env, user, 'message-1', '127.0.0.1')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: RETRY_QUEUE_FAILURE_MESSAGE })
    expect(markedFailed()).toBe(true)
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO audit_logs'))).toBe(false)
  })

  it('incoming mail is stored for automatic parsing instead of being bounced', async () => {
    const { env, bucket, markedFailed, flagged } = environment((sql) => (
      sql.includes('FROM users u') ? { id: 'owner-1' } : null
    ))
    const message = {
      to: 'unknown@example.com',
      from: 'sender@example.net',
      rawSize: 20,
      raw: new Response('Subject: Test\r\n\r\nHello').body,
      headers: new Headers({ subject: 'Test', 'message-id': '<queue@example.net>' }),
      setReject: vi.fn(),
    }

    await expect(receiveEmail(message as unknown as ForwardableEmailMessage, env)).resolves.toBeUndefined()
    expect(message.setReject).not.toHaveBeenCalled()
    expect(bucket.put).toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(markedFailed()).toBe(true)
    expect(flagged()).toBe(true)
  })
})
