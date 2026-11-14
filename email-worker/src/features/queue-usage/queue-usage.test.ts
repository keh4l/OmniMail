import { afterEach, describe, expect, it, vi } from 'vitest'
import { d1, insert, migratedDatabase } from '../../../test-support/sqlite-d1'
import {
  BACKGROUND_OPERATION_BUDGET,
  claimBackgroundOperations,
  nextUsageResetAt,
  purgeOldQueueUsage,
  QueueBudgetError,
  queueOperationsUsed,
  queueUsageEnvironment,
  recordQueueRedeliveries,
  usageKey,
} from './queue-usage'
import type { Env, MailQueueJob } from '../../app/types'

const NOW = Date.parse('2026-11-14T10:00:00Z')

function setup(used?: number) {
  const db = migratedDatabase()
  if (used !== undefined) insert(db, 'settings', { key: usageKey(NOW), value: String(used) })
  const send = vi.fn(async (_job: MailQueueJob) => undefined)
  const env = { DB: d1(db), MAIL_QUEUE: { send, sendBatch: vi.fn(), metrics: vi.fn() } } as unknown as Env
  return { db, env, send }
}

function used(env: Env): Promise<number> {
  return queueOperationsUsed(env.DB, NOW)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('queue usage keys', () => {
  it('counts per UTC day and resets at UTC midnight', () => {
    expect(usageKey(Date.parse('2026-11-13T23:59:59Z'))).toBe('queue_operations:2026-11-13')
    expect(usageKey(Date.parse('2026-11-14T00:00:00Z'))).toBe('queue_operations:2026-11-14')
    expect(nextUsageResetAt(NOW)).toBe(Date.parse('2026-11-15T00:00:00Z'))
  })
})

describe('background budget', () => {
  it('claims operations atomically up to the budget', async () => {
    const { env } = setup(BACKGROUND_OPERATION_BUDGET - 6)
    await expect(claimBackgroundOperations(env.DB, 3, NOW)).resolves.toBe(true)
    await expect(claimBackgroundOperations(env.DB, 3, NOW)).resolves.toBe(true)
    await expect(claimBackgroundOperations(env.DB, 3, NOW)).resolves.toBe(false)
    await expect(used(env)).resolves.toBe(BACKGROUND_OPERATION_BUDGET)
  })

  it('starts a new day from zero', async () => {
    const { env } = setup(BACKGROUND_OPERATION_BUDGET)
    const tomorrow = NOW + 86_400_000
    await expect(claimBackgroundOperations(env.DB, 3, tomorrow)).resolves.toBe(true)
    await expect(queueOperationsUsed(env.DB, tomorrow)).resolves.toBe(3)
  })

  it('refuses background jobs once the budget is spent, without calling the queue', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { env, send } = setup(BACKGROUND_OPERATION_BUDGET - 2)
    const background = queueUsageEnvironment(env, 'background')
    const job: MailQueueJob = { kind: 'microsoft-sync', accountId: 'a', reason: 'scheduled' }

    await expect(background.MAIL_QUEUE.send(job)).rejects.toBeInstanceOf(QueueBudgetError)
    await expect(background.MAIL_QUEUE.send(job)).rejects.toBeInstanceOf(QueueBudgetError)
    expect(send).not.toHaveBeenCalled()
    await expect(used(env)).resolves.toBe(BACKGROUND_OPERATION_BUDGET - 2)
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'queue_background_budget_reached' }))
  })

  it('returns the reserved operations when the queue rejects a background job', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { env, send } = setup(100)
    send.mockRejectedValueOnce(new Error('Queue operation limit exceeded'))
    const background = queueUsageEnvironment(env, 'background')

    await expect(background.MAIL_QUEUE.send({ kind: 'gmail-sync', accountId: 'g', reason: 'scheduled' }))
      .rejects.toThrow('Queue operation limit exceeded')
    await expect(used(env)).resolves.toBe(100)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      event: 'queue_send_failed',
      mode: 'background',
      kind: 'gmail-sync',
      error_message: 'Queue operation limit exceeded',
    }))
  })
})

describe('foreground jobs', () => {
  it('are never blocked by the background budget and are counted after a successful send', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const { env, send } = setup(9_990)
    const foreground = queueUsageEnvironment(env)

    await foreground.MAIL_QUEUE.send({ kind: 'parse', messageId: 'm1' })
    expect(send).toHaveBeenCalledOnce()
    await expect(used(env)).resolves.toBe(9_993)
  })

  it('are not counted when the queue rejects them, and the error still reaches the caller', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { env, send } = setup(50)
    send.mockRejectedValueOnce(new Error('limit'))
    const foreground = queueUsageEnvironment(env)

    await expect(foreground.MAIL_QUEUE.send({ kind: 'parse', messageId: 'm1' })).rejects.toThrow('limit')
    await expect(used(env)).resolves.toBe(50)
  })

  it('still send when the usage counter cannot be written', async () => {
    const send = vi.fn(async () => undefined)
    const failingDb = {
      prepare: () => { throw new Error('D1 unavailable') },
    } as unknown as D1Database
    const env = { DB: failingDb, MAIL_QUEUE: { send } } as unknown as Env

    await expect(queueUsageEnvironment(env).MAIL_QUEUE.send({ kind: 'parse', messageId: 'm' }))
      .resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
  })

  it('counts each message once even when the environment is wrapped twice', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const { env, send } = setup()
    const wrapped = queueUsageEnvironment(queueUsageEnvironment(env), 'background')

    await wrapped.MAIL_QUEUE.send({ kind: 'gmail-sync', accountId: 'g', reason: 'scheduled' })
    expect(send).toHaveBeenCalledOnce()
    await expect(used(env)).resolves.toBe(3)
  })

  it('counts every message of a batch', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const { env } = setup()
    const sendBatch = vi.fn(async () => undefined)
    const wrapped = queueUsageEnvironment({ ...env, MAIL_QUEUE: { ...env.MAIL_QUEUE, sendBatch } } as Env)

    await wrapped.MAIL_QUEUE.sendBatch([
      { body: { kind: 'parse', messageId: 'a' } },
      { body: { kind: 'parse', messageId: 'b' } },
    ])
    expect(sendBatch).toHaveBeenCalledOnce()
    await expect(used(env)).resolves.toBe(6)
  })
})

describe('usage bookkeeping', () => {
  it('adds one read operation for every redelivered message', async () => {
    const { env } = setup(10)
    const batch = { messages: [{ attempts: 1 }, { attempts: 2 }, { attempts: 3 }] } as MessageBatch<unknown>
    await recordQueueRedeliveries(env.DB, batch, NOW)
    await expect(used(env)).resolves.toBe(12)
  })

  it('keeps a week of daily counters and leaves other settings alone', async () => {
    const { db, env } = setup()
    for (const day of ['2026-11-01', '2026-11-06', '2026-11-07', '2026-11-14']) {
      insert(db, 'settings', { key: `queue_operations:${day}`, value: '1' })
    }
    insert(db, 'settings', { key: 'queue_failure_retry_pending', value: 'x' })
    await purgeOldQueueUsage(env.DB, NOW)
    const keys = (db.prepare("SELECT key FROM settings WHERE key LIKE 'queue_%' ORDER BY key").all() as Array<{ key: string }>)
      .map(({ key }) => key)
    expect(keys).toEqual([
      'queue_failure_retry_pending',
      'queue_operations:2026-11-07',
      'queue_operations:2026-11-14',
    ])
  })
})
