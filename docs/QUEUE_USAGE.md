# Cloudflare Queues 用量控制（Fork）

Workers 免费版的 Queues 每天只有 10,000 次操作，UTC 0 点重置，整个账号的队列共用。
小于 64 KB 的消息正常投递一次算 3 次操作（写、读、删），每次重试再加 1 次读。
额度用完后 `send()` 会失败，定时同步、发信、收信解析都发不进队列。

代码在 `email-worker/src/features/queue-usage/`。上游文件只改了几处调用，同步上游时注意以下位置：

- `email-worker/src/index.ts`：给各入口包上用量记账；`scheduled` 先补发入队失败的邮件，再按后台预算跑 `cleanup`。
- 6 个 `*-sync.ts` 的消费函数：改为调用 `shouldRetrySyncJob`。
- `microsoft-sync.ts`、`gmail-sync.ts`：同步成功后调用 `relaxQuietSyncInterval`。
- `outbound-message.ts`、`failed-mail-api.ts`、`app/handlers/mail.ts`：入队失败时调用 `recordQueueFailure`。

## 机制

| 机制 | 做法 | 位置 |
| --- | --- | --- |
| 定时同步不在队列里重试 | `reason: 'scheduled'` 的同步失败后直接 ack，等下一轮定时同步；手动同步和刚连接时仍会重试 | `sync-cadence.ts` 的 `shouldRetrySyncJob` |
| 安静账号放宽间隔 | 收件箱 7 天内没有新信的 Microsoft / Gmail 账号，下次同步推迟到 30 分钟后；收到新信后自动恢复 | `sync-cadence.ts` 的 `relaxQuietSyncInterval` |
| 后台每日预算 | 在 D1 `settings` 里按 UTC 日期记账（键名 `queue_operations:YYYY-MM-DD`）。定时任务发的消息先预占额度，累计超过 8,000 次就拒发（抛 `QueueBudgetError`）；发信、收信解析、手动同步只记账、不拦；每次重投递加 1 | `queue-usage.ts` |
| 入队失败自动补发 | 发信、收信解析入队失败时，邮件保存为 failed，错误信息前缀是「任务队列暂不可用：」。定时任务每 5 分钟把 24 小时内这类失败的重新入队；仍失败就停，并保留第一次失败的时间。超过 24 小时的留给管理员在「失败邮件恢复中心」手动重发 | `queue-recovery.ts` |

记账按自己发出的消息估算，和 Cloudflare 的计数会有少量偏差，所以预算线留了 2,000 次余量。

## 日志事件

| `event` | 含义 |
| --- | --- |
| `queue_send_failed` | `send()` 失败；`error_message` 记录 Cloudflare 返回的原文 |
| `queue_background_budget_reached` | 当天后台预算用完（每个实例每天最多记一次），定时同步暂停到 UTC 0 点 |
| `queue_failures_requeued` | 定时任务补发了入队失败的邮件 |
| `queue_maintenance_failed` | 补发或清理用量记录时出错（不影响后面的定时同步） |
| `quiet_sync_interval_failed` | 放宽同步间隔时出错（不影响同步结果） |

后台预算用完期间，`cleanup` 原有的「Unable to enqueue … synchronization」错误日志每 5 分钟会出现一次，属于预期行为。

## 查看实际用量

在后台打开 **Queues → 队列 → Metrics**，或者用 GraphQL Analytics API 按天汇总（需要有 Account Analytics 读取权限的 Token）：

```graphql
query Ops($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      queueMessageOperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [date_ASC]
      ) {
        sum { billableOperations }
        dimensions { date queueId actionType }
      }
    }
  }
}
```

`ReadMessage` 明显多于 `WriteMessage`，说明有大量重试。
