import { afterEach, describe, expect, it, vi } from 'vitest'
import { d1, insert, migratedDatabase } from '../../../test-support/sqlite-d1'
import {
  AUTO_RETRY_WINDOW_SECONDS,
  isQueueFailure,
  QUEUE_FAILURE_PREFIX,
  queueFailureDetail,
  recordQueueFailure,
  requeueQueueFailures,
  retryJob,
} from './queue-recovery'
import type { Env, MailQueueJob } from '../../app/types'

const NOW = 2_000_000_000

function setup() {
  const db = migratedDatabase()
  insert(db, 'users', { id: 'owner', email: 'owner@example.com' })
  insert(db, 'mailboxes', { address: 'owner@example.com', user_id: 'owner' })
  const sent: MailQueueJob[] = []
  const send = vi.fn(async (job: MailQueueJob) => { sent.push(job) })
  const env = { DB: d1(db), MAIL_QUEUE: { send } } as unknown as Env
  const message = (id: string, values: Record<string, string | number | null> = {}) => insert(db, 'messages', {
    id, mailbox_address: 'owner@example.com', direction: 'outgoing', status: 'failed', folder: 'sent',
    sender_address: 'owner@example.com', recipients_json: '["friend@example.net"]', body_key: `bodies/${id}.json`,
    processing_error: `${QUEUE_FAILURE_PREFIX}limit`, last_failed_at: NOW - 60, ...values,
  })
  const row = (id: string) => db.prepare(
    'SELECT status, processing_error, last_failed_at, delivery_status FROM messages WHERE id = ?',
  ).get(id) as { status: string; processing_error: string | null; last_failed_at: number; delivery_status: string | null }
  const pending = () => db.prepare("SELECT value FROM settings WHERE key = 'queue_failure_retry_pending'").get() as
    { value: string } | undefined
  const flag = () => insert(db, 'settings', { key: 'queue_failure_retry_pending', value: 'flag-1' })
  return { db, env, send, sent, message, row, pending, flag }
}

afterEach(() => vi.restoreAllMocks())

describe('queue failure details', () => {
  it('marks queue failures with a stable prefix', () => {
    expect(queueFailureDetail(new Error('Queue limit'))).toBe(`${QUEUE_FAILURE_PREFIX}Queue limit`)
    expect(queueFailureDetail('boom')).toBe(`${QUEUE_FAILURE_PREFIX}Unable to queue message`)
    expect(queueFailureDetail(new Error('x'.repeat(600)))).toHaveLength(500)
    expect(isQueueFailure(`${QUEUE_FAILURE_PREFIX}x`)).toBe(true)
    expect(isQueueFailure('Provider rejected the message')).toBe(false)
    expect(isQueueFailure(null)).toBe(false)
  })

  it('rebuilds the original job type for each kind of message', () => {
    const base = { id: 'm', in_reply_to: null, recipients_json: '["a@b.c"]', user_id: 'u', linux_do_mail_account: 0, qq_mail_account: 0 }
    expect(retryJob({ ...base, direction: 'incoming' })).toEqual({ kind: 'parse', messageId: 'm' })
    expect(retryJob({ ...base, direction: 'outgoing' })).toMatchObject({
      kind: 'outbound', messageId: 'm', userId: 'u', auditAction: 'message.send',
      auditDetail: { recipients: ['a@b.c'], automaticRetry: true },
    })
    expect(retryJob({ ...base, direction: 'outgoing', in_reply_to: '<x@y>' })).toMatchObject({ auditAction: 'message.reply' })
    expect(retryJob({ ...base, direction: 'outgoing', linux_do_mail_account: 1 }))
      .toMatchObject({ auditAction: 'linuxdo_mail.message.send' })
    expect(retryJob({ ...base, direction: 'outgoing', qq_mail_account: 1 }))
      .toMatchObject({ auditAction: 'qq_mail.message.send' })
    expect(retryJob({ ...base, direction: 'outgoing', recipients_json: 'not json' }))
      .toMatchObject({ auditDetail: { recipients: [] } })
  })
})

describe('recordQueueFailure', () => {
  it('keeps the message as a retryable failure and flags it for the scheduler', async () => {
    const { env, message, row, pending } = setup()
    message('m1', { status: 'processing', processing_error: null, last_failed_at: null })

    await recordQueueFailure(env, 'm1', new Error('Queue limit'))
    expect(row('m1')).toMatchObject({ status: 'failed', processing_error: `${QUEUE_FAILURE_PREFIX}Queue limit` })
    expect(row('m1').last_failed_at).toBeGreaterThan(0)
    expect(pending()?.value).toBeTruthy()
  })
})

describe('requeueQueueFailures', () => {
  it('does nothing and does not scan messages while nothing is pending', async () => {
    const { env, send } = setup()
    const prepare = vi.spyOn(env.DB, 'prepare')
    await expect(requeueQueueFailures(env, NOW)).resolves.toBe(0)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('requeues recent queue failures in the order they failed, then clears the flag', async () => {
    const { env, sent, message, row, pending, flag } = setup()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    flag()
    message('reply', { in_reply_to: '<x@example.net>', last_failed_at: NOW - 30 })
    message('send', { last_failed_at: NOW - 3_600 })
    message('inbound', { direction: 'incoming', folder: 'inbox', raw_key: 'raw/inbound.eml', last_failed_at: NOW - 10 })
    message('old', { last_failed_at: NOW - AUTO_RETRY_WINDOW_SECONDS - 1 })
    message('provider', { processing_error: 'Provider rejected the message' })
    message('sent-already', { status: 'sent' })

    await expect(requeueQueueFailures(env, NOW)).resolves.toBe(3)
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'outbound', messageId: 'send', auditAction: 'message.send', userId: 'owner' }),
      expect.objectContaining({ kind: 'outbound', messageId: 'reply', auditAction: 'message.reply' }),
      { kind: 'parse', messageId: 'inbound' },
    ])
    expect(row('send')).toMatchObject({ status: 'processing', processing_error: null, delivery_status: 'queued' })
    expect(row('inbound')).toMatchObject({ status: 'processing', processing_error: null })
    expect(row('old').status).toBe('failed')
    expect(row('provider').status).toBe('failed')
    expect(pending()).toBeUndefined()
  })

  it('stops at the first queue error and keeps the original failure time', async () => {
    const { env, send, message, row, pending, flag } = setup()
    flag()
    message('a', { last_failed_at: NOW - 600 })
    message('b', { last_failed_at: NOW - 300 })
    send.mockRejectedValueOnce(new Error('still over the limit'))

    await expect(requeueQueueFailures(env, NOW)).resolves.toBe(0)
    expect(send).toHaveBeenCalledOnce()
    expect(row('a')).toMatchObject({
      status: 'failed',
      processing_error: `${QUEUE_FAILURE_PREFIX}still over the limit`,
      last_failed_at: NOW - 600,
    })
    expect(row('b').status).toBe('failed')
    expect(pending()?.value).toBe('flag-1')
  })

  it('keeps the flag when another failure is recorded while it runs', async () => {
    const { env, send, message, pending, flag } = setup()
    flag()
    message('a')
    message('late', { status: 'processing', processing_error: null, last_failed_at: null })
    send.mockImplementationOnce(async () => { await recordQueueFailure(env, 'late', new Error('limit')) })

    await expect(requeueQueueFailures(env, NOW)).resolves.toBe(1)
    expect(pending()?.value).not.toBe('flag-1')
    expect(pending()).toBeDefined()
  })

  it('clears a stale flag when only failures older than 24 hours remain', async () => {
    const { env, send, message, pending, flag } = setup()
    flag()
    message('old', { last_failed_at: NOW - AUTO_RETRY_WINDOW_SECONDS - 60 })

    await expect(requeueQueueFailures(env, NOW)).resolves.toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(pending()).toBeUndefined()
  })
})
