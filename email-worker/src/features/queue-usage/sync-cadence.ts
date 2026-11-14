// 定时同步的节奏控制：省队列额度，又不影响有新信的账号。

// 收件箱 7 天内没有新信的账号，定时同步放宽到 30 分钟一次；收到新信后下一次同步自动恢复原间隔。
export const QUIET_AFTER_SECONDS = 7 * 24 * 60 * 60
export const QUIET_SYNC_INTERVAL_SECONDS = 30 * 60

export type QuietSyncTarget =
  | { provider: 'microsoft'; accountId: string; folderPath: string }
  | { provider: 'gmail'; accountId: string }

// 都走 (account_id[, folder_path], 时间 DESC) 索引，只读 1 行。
const LATEST_MAIL_SQL = {
  microsoft: `SELECT received_at AS latest FROM microsoft_imap_messages
                WHERE account_id = ? AND folder_path = ?
                ORDER BY received_at DESC LIMIT 1`,
  gmail: `SELECT internal_date AS latest FROM gmail_imap_messages
            WHERE account_id = ?
            ORDER BY internal_date DESC LIMIT 1`,
} as const

const ACCOUNT_TABLE = {
  microsoft: 'microsoft_imap_accounts',
  gmail: 'gmail_imap_accounts',
} as const

// 定时同步失败不在队列里重试：下一轮定时同步本来就会再试，队列重试只会多花额度。
// 用户手动触发或刚连接的同步仍然重试，保证及时反馈。
export function shouldRetrySyncJob(reason: string, attempts: number, retryable: boolean): boolean {
  return retryable && reason !== 'scheduled' && attempts < 3
}

export function isQuietMailbox(latestMailAt: number | null | undefined, now: number): boolean {
  return !latestMailAt || now - latestMailAt >= QUIET_AFTER_SECONDS
}

// 同步成功、已写入 next_sync_at = scheduledAt 之后调用。安静账号把下次同步推迟到 30 分钟后；
// 只在 next_sync_at 仍是刚写入的值时更新，避免覆盖手动验证等操作。出错只记日志，不影响同步结果。
export async function relaxQuietSyncInterval(
  db: D1Database,
  target: QuietSyncTarget,
  now: number,
  scheduledAt: number,
): Promise<void> {
  try {
    const latest = target.provider === 'microsoft'
      ? await db.prepare(LATEST_MAIL_SQL.microsoft)
        .bind(target.accountId, target.folderPath).first<{ latest: number }>()
      : await db.prepare(LATEST_MAIL_SQL.gmail)
        .bind(target.accountId).first<{ latest: number }>()
    if (!isQuietMailbox(latest?.latest, now)) return
    const nextSyncAt = now + QUIET_SYNC_INTERVAL_SECONDS
    if (nextSyncAt <= scheduledAt) return
    await db.prepare(
      `UPDATE ${ACCOUNT_TABLE[target.provider]} SET next_sync_at = ?
        WHERE id = ? AND status = 'active' AND next_sync_at = ?`,
    ).bind(nextSyncAt, target.accountId, scheduledAt).run()
  } catch (error) {
    console.warn({
      event: 'quiet_sync_interval_failed',
      provider: target.provider,
      account_id: target.accountId,
      error_message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    })
  }
}
