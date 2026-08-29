import { type DbClient, type OutboxEventStatus, schema } from '@epinfresh/database'
import { and, eq, lt, sql } from 'drizzle-orm'

export interface OutboxEventInput {
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
}

export type OutboxEventRecord = typeof schema.outboxEvents.$inferSelect

// 每批 claim 上限(worker 每 tick 处理一批)
export const OUTBOX_BATCH_SIZE = 20
// 超过次数进死信(failed), 由人工/告警介入
export const OUTBOX_MAX_ATTEMPTS = 5
// processing 卡死判定阈值: claim 后进程崩溃的事件永远停在 processing(claim 只捞 pending),
// 超过该时长视为 claim 方已死, 回收重投。正常 handler 为毫秒级(入队出站), 余量充足。
export const OUTBOX_STALE_THRESHOLD_MS = 5 * 60 * 1000
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 60000

// 指数退避: base * 2^(attempts-1), 封顶 60s
function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), RETRY_MAX_DELAY_MS)
}

// 事务内写事件; 由编排方(usecase/worker)在同一事务中调用, 与业务写入同生共死。
export async function insertOutboxEvent(client: DbClient, input: OutboxEventInput): Promise<void> {
  await client.insert(schema.outboxEvents).values({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
  })
}

// 原子抢占一批待投递事件: 单条 UPDATE 内 SELECT ... FOR UPDATE SKIP LOCKED,
// 多 worker 副本不会重复抢占; 抢占即 attempts+1, 状态置 processing。
// drizzle 0.40 无 skipLocked helper, 子查询用原生 SQL 内联(drizzle 参数化 limit)。
export async function claimOutboxBatch(
  client: DbClient,
  limit = OUTBOX_BATCH_SIZE,
): Promise<OutboxEventRecord[]> {
  return client
    .update(schema.outboxEvents)
    .set({
      status: 'processing',
      attempts: sql`${schema.outboxEvents.attempts} + 1`,
    })
    .where(
      sql`${schema.outboxEvents.id} IN (
        SELECT id FROM outbox_events
        WHERE status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning()
}

export async function completeOutboxEvent(client: DbClient, id: string): Promise<void> {
  await client
    .update(schema.outboxEvents)
    .set({ status: 'completed', processedAt: new Date() })
    .where(and(eq(schema.outboxEvents.id, id), eq(schema.outboxEvents.status, 'processing')))
}

// 投递失败: 未超次回到 pending + 指数退避, 超次进死信(failed)。
// attempts 为 claim 后的值(已 +1)。
export async function failOutboxEvent(
  client: DbClient,
  id: string,
  attempts: number,
): Promise<void> {
  const deadLettered = attempts >= OUTBOX_MAX_ATTEMPTS
  const status: OutboxEventStatus = deadLettered ? 'failed' : 'pending'
  await client
    .update(schema.outboxEvents)
    .set({
      status,
      nextRetryAt: deadLettered ? null : new Date(Date.now() + retryDelayMs(attempts)),
    })
    .where(and(eq(schema.outboxEvents.id, id), eq(schema.outboxEvents.status, 'processing')))
}

// 回收卡死的 processing 事件: claim 后 claim 方崩溃则无人 complete/fail,
// 行永久停在 processing(claim 只捞 pending)。对 processing 行而言 updated_at
// 即 claim 时刻(claim 后无任何 UPDATE 触碰该行), 故以 updated_at < staleBefore
// 判定 claim 方已死。复位 pending 且 next_retry_at=now(本轮 claim 即可重投);
// attempts 不动——崩溃那次已计入, 反复崩溃自然收敛到死信, 不会无限回收。
// 返回重置行数, >0 即发生过崩溃/误回收, 调用方应记 warn。
export async function resetStaleOutboxEvents(client: DbClient, staleBefore: Date): Promise<number> {
  const rows = await client
    .update(schema.outboxEvents)
    .set({ status: 'pending', nextRetryAt: new Date() })
    .where(
      and(
        eq(schema.outboxEvents.status, 'processing'),
        lt(schema.outboxEvents.updatedAt, staleBefore),
      ),
    )
    .returning({ id: schema.outboxEvents.id })
  return rows.length
}
