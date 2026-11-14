import type { Env } from '../../app/types'

// Cloudflare Queues 免费版每天 10,000 次操作（UTC 0 点重置），整个账号的队列共用。
// 小于 64 KB 的消息正常投递一次算 3 次（写、读、删），每次重试再加 1 次读。
// 这里按自己发出的消息估算当天用量：后台任务只能用到预算线，剩下的留给发信、收信解析和手动同步。
export const OPERATIONS_PER_MESSAGE = 3
export const BACKGROUND_OPERATION_BUDGET = 8_000
const USAGE_KEY_PREFIX = 'queue_operations:'
const USAGE_RETENTION_DAYS = 7
const DAY_MS = 86_400_000

export type QueueUsageMode = 'foreground' | 'background'

export class QueueBudgetError extends Error {
  constructor(readonly used: number, readonly resetAt: number) {
    super('今日后台任务的队列预算已用完，定时同步暂停到 UTC 0 点。')
    this.name = 'QueueBudgetError'
  }
}

export function usageKey(nowMs: number): string {
  return `${USAGE_KEY_PREFIX}${new Date(nowMs).toISOString().slice(0, 10)}`
}

export function nextUsageResetAt(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS) * DAY_MS + DAY_MS
}

export async function queueOperationsUsed(db: D1Database, nowMs = Date.now()): Promise<number> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(usageKey(nowMs)).first<{ value: string }>()
  return Number(row?.value || 0)
}

// 无条件累加（可为负数，用于入队失败时退回预占的额度）。
export async function addQueueOperations(
  db: D1Database,
  operations: number,
  nowMs = Date.now(),
): Promise<void> {
  if (!operations) return
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = CAST(MAX(0, CAST(settings.value AS INTEGER) + ?) AS TEXT),
       updated_at = excluded.updated_at`,
  ).bind(usageKey(nowMs), String(Math.max(0, operations)), Math.floor(nowMs / 1000), operations).run()
}

// 原子地预占后台额度：加上这次之后不超过预算才记账，返回是否预占成功。
export async function claimBackgroundOperations(
  db: D1Database,
  operations: number,
  nowMs = Date.now(),
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = CAST(CAST(settings.value AS INTEGER) + ? AS TEXT),
       updated_at = excluded.updated_at
     WHERE CAST(settings.value AS INTEGER) + ? <= ?`,
  ).bind(
    usageKey(nowMs), String(operations), Math.floor(nowMs / 1000),
    operations, operations, BACKGROUND_OPERATION_BUDGET,
  ).run()
  return Boolean(result.meta.changes)
}

export async function purgeOldQueueUsage(db: D1Database, nowMs = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key >= ? AND key < ?')
    .bind(USAGE_KEY_PREFIX, usageKey(nowMs - USAGE_RETENTION_DAYS * DAY_MS)).run()
}

// 每条重投递（attempts > 1）多 1 次读操作。只用于估算，记账失败不影响消费。
export async function recordQueueRedeliveries(
  db: D1Database,
  batch: MessageBatch<unknown>,
  nowMs = Date.now(),
): Promise<void> {
  const redeliveries = batch.messages.filter((message) => message.attempts > 1).length
  await addQueueOperations(db, redeliveries, nowMs).catch(() => undefined)
}

function jobKind(body: unknown): string {
  if (!body || typeof body !== 'object') return 'unknown'
  const kind = (body as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : 'parse'
}

// Cloudflare 额度用完时 send() 抛出的具体错误没有文档，这里把原文记下来，便于以后精确识别。
function logSendFailure(queueName: string, mode: QueueUsageMode, body: unknown, error: unknown) {
  console.error({
    event: 'queue_send_failed',
    queue: queueName,
    mode,
    kind: jobKind(body),
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
  })
}

const rawQueues = new WeakMap<object, Queue<unknown>>()
let budgetWarnedFor = ''

function countedQueue<Body>(
  queue: Queue<Body>,
  db: D1Database,
  queueName: string,
  mode: QueueUsageMode,
): Queue<Body> {
  const raw = (rawQueues.get(queue) ?? queue) as Queue<Body>

  async function reserve(operations: number, nowMs: number): Promise<void> {
    if (mode !== 'background') return
    if (await claimBackgroundOperations(db, operations, nowMs)) return
    const used = await queueOperationsUsed(db, nowMs).catch(() => BACKGROUND_OPERATION_BUDGET)
    const day = usageKey(nowMs)
    if (budgetWarnedFor !== day) {
      budgetWarnedFor = day
      console.warn({
        event: 'queue_background_budget_reached',
        used, budget: BACKGROUND_OPERATION_BUDGET, reset_at: nextUsageResetAt(nowMs),
      })
    }
    throw new QueueBudgetError(used, nextUsageResetAt(nowMs))
  }

  async function settle(operations: number, nowMs: number, sent: boolean): Promise<void> {
    if (mode === 'background') {
      if (!sent) await addQueueOperations(db, -operations, nowMs).catch(() => undefined)
      return
    }
    // 用户操作的任务只记账，不拦截；记账失败也不能让已入队的任务报错。
    if (sent) await addQueueOperations(db, operations, nowMs).catch(() => undefined)
  }

  const wrapped: Queue<Body> = {
    metrics: () => raw.metrics(),
    async send(body, options) {
      const nowMs = Date.now()
      await reserve(OPERATIONS_PER_MESSAGE, nowMs)
      try {
        const response = await raw.send(body, options)
        await settle(OPERATIONS_PER_MESSAGE, nowMs, true)
        return response
      } catch (error) {
        logSendFailure(queueName, mode, body, error)
        await settle(OPERATIONS_PER_MESSAGE, nowMs, false)
        throw error
      }
    },
    async sendBatch(messages, options) {
      const list = [...messages]
      const operations = list.length * OPERATIONS_PER_MESSAGE
      const nowMs = Date.now()
      await reserve(operations, nowMs)
      try {
        const response = await raw.sendBatch(list, options)
        await settle(operations, nowMs, true)
        return response
      } catch (error) {
        logSendFailure(queueName, mode, list[0]?.body, error)
        await settle(operations, nowMs, false)
        throw error
      }
    },
  }
  rawQueues.set(wrapped, raw)
  return wrapped
}

// 给环境里的队列加上用量记账。background 只用于定时任务的 MAIL_QUEUE，超出预算会抛 QueueBudgetError；
// 通知队列始终按用户操作处理。重复包装时会先取回原始队列，不会重复记账。
export function queueUsageEnvironment(env: Env, mode: QueueUsageMode = 'foreground'): Env {
  return {
    ...env,
    MAIL_QUEUE: countedQueue(env.MAIL_QUEUE, env.DB, 'omnimail-mail', mode),
    NOTIFICATION_QUEUE: env.NOTIFICATION_QUEUE
      ? countedQueue(env.NOTIFICATION_QUEUE, env.DB, 'omnimail-notifications', 'foreground')
      : undefined,
  }
}

