import type { Env, MailQueueJob, OutboundJob } from '../../app/types'
import { isD1QuotaError } from '../../platform/d1/quota-guard'
import { purgeOldQueueUsage } from './queue-usage'

// 发信、收信解析入队失败（多半是 Cloudflare Queues 当日额度用完）时，邮件已经保存在 D1 / R2，
// 标记为带此前缀的 failed。定时任务在 24 小时内自动重新入队；更早的留给管理员在「失败邮件恢复中心」手动重发。
export const QUEUE_FAILURE_PREFIX = '任务队列暂不可用：'
export const AUTO_RETRY_WINDOW_SECONDS = 24 * 60 * 60
export const AUTO_RETRY_BATCH = 20
const PENDING_KEY = 'queue_failure_retry_pending'
const AUTO_RETRY_IP = 'queue-retry'

export const OUTBOUND_QUEUE_FAILURE_MESSAGE =
  '发送任务暂时无法入队，可能是今日队列额度已用完（每天 UTC 0 点重置）。邮件已保存，24 小时内会自动重发，不用重复发送；管理员也可以在「失败邮件恢复中心」手动重发。'
export const RETRY_QUEUE_FAILURE_MESSAGE =
  '重新提交失败：任务队列暂不可用，可能是今日队列额度已用完（每天 UTC 0 点重置）。24 小时内会自动重试。'

export function queueFailureDetail(error: unknown): string {
  const detail = error instanceof Error && error.message ? error.message : 'Unable to queue message'
  return `${QUEUE_FAILURE_PREFIX}${detail}`.slice(0, 500)
}

export function isQueueFailure(processingError: string | null | undefined): boolean {
  return Boolean(processingError?.startsWith(QUEUE_FAILURE_PREFIX))
}

// 把已保存的邮件标记为「入队失败」，并打上待重试标记，让定时任务不用每次都扫描 messages 表。
export async function recordQueueFailure(
  env: Pick<Env, 'DB'>,
  messageId: string,
  error: unknown,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE messages
          SET status = 'failed', processing_error = ?, last_failed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(queueFailureDetail(error), now, now, messageId),
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(PENDING_KEY, crypto.randomUUID(), now),
  ])
}

interface QueueFailureRow {
  id: string
  direction: 'incoming' | 'outgoing'
  in_reply_to: string | null
  recipients_json: string
  user_id: string
  linux_do_mail_account: number
  qq_mail_account: number
}

function recipients(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return [] }
}

export function retryJob(row: QueueFailureRow): MailQueueJob {
  if (row.direction === 'incoming') return { kind: 'parse', messageId: row.id }
  const auditAction: OutboundJob['auditAction'] = row.linux_do_mail_account
    ? 'linuxdo_mail.message.send'
    : row.qq_mail_account
      ? 'qq_mail.message.send'
      : row.in_reply_to ? 'message.reply' : 'message.send'
  return {
    kind: 'outbound',
    messageId: row.id,
    userId: row.user_id,
    ip: AUTO_RETRY_IP,
    auditAction,
    auditDetail: { recipients: recipients(row.recipients_json), automaticRetry: true },
  }
}

// 每次定时任务调用。没有待重试标记时只读 1 行；队列仍不可用时第一条失败就停，不改原来的失败时间。
export async function requeueQueueFailures(
  env: Env,
  now = Math.floor(Date.now() / 1000),
): Promise<number> {
  const pending = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(PENDING_KEY).first<{ value: string }>()
  if (!pending) return 0
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.direction, m.in_reply_to, m.recipients_json, mb.user_id,
            (mb.is_hidden = 1 AND EXISTS (
              SELECT 1 FROM linux_do_mail_accounts la
               WHERE la.username = m.mailbox_address AND la.user_id = mb.user_id
            )) AS linux_do_mail_account,
            (mb.is_hidden = 1 AND EXISTS (
              SELECT 1 FROM qq_mail_identities qi
              JOIN qq_mail_accounts qa ON qa.id = qi.account_id
               WHERE qi.email = m.mailbox_address AND qa.user_id = mb.user_id
            )) AS qq_mail_account
       FROM messages m
       JOIN mailboxes mb ON mb.address = m.mailbox_address
      WHERE m.status = 'failed' AND m.processing_error LIKE ? AND m.last_failed_at >= ?
      ORDER BY m.last_failed_at, m.id
      LIMIT ?`,
  ).bind(`${QUEUE_FAILURE_PREFIX}%`, now - AUTO_RETRY_WINDOW_SECONDS, AUTO_RETRY_BATCH)
    .all<QueueFailureRow>()

  let requeued = 0
  for (const row of results) {
    const claimed = await env.DB.prepare(
      `UPDATE messages
          SET status = 'processing', processing_error = NULL,
              delivery_status = CASE WHEN direction = 'outgoing' THEN 'queued' ELSE delivery_status END,
              updated_at = ?
        WHERE id = ? AND status = 'failed' AND processing_error LIKE ?`,
    ).bind(now, row.id, `${QUEUE_FAILURE_PREFIX}%`).run()
    if (!claimed.meta.changes) continue
    try {
      await env.MAIL_QUEUE.send(retryJob(row))
      requeued += 1
    } catch (error) {
      // 恢复成失败状态但保留原来的 last_failed_at，24 小时窗口从第一次失败算起。
      await env.DB.prepare(
        `UPDATE messages SET status = 'failed', processing_error = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'`,
      ).bind(queueFailureDetail(error), now, row.id).run()
      return requeued
    }
  }
  if (requeued) console.info({ event: 'queue_failures_requeued', count: requeued })
  // 这一批处理完且没有更多候选时清除标记；期间如有新的失败写入，标记值会变，不会被误删。
  if (results.length < AUTO_RETRY_BATCH) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ? AND value = ?')
      .bind(PENDING_KEY, pending.value).run()
  }
  return requeued
}

// 定时任务入口：先把入队失败的邮件补回队列（排在后台同步之前），再清理旧的用量记录。
// 除 D1 额度错误外都只记日志，不能挡住后面的定时同步。
export async function runQueueMaintenance(env: Env): Promise<void> {
  try {
    await requeueQueueFailures(env)
    await purgeOldQueueUsage(env.DB)
  } catch (error) {
    if (isD1QuotaError(error)) throw error
    console.error({
      event: 'queue_maintenance_failed',
      error_message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    })
  }
}
