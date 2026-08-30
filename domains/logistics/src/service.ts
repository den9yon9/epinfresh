import { type DbClient, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { eq, inArray } from 'drizzle-orm'

import { type LogisticsProvider, type TrackSnapshot } from './model'
import { toTrackEvents } from './model'

// 查询并落库单个订单的轨迹快照: provider 拉取 → 按 orderId upsert。
// 事件整体替换(快照语义, 非追加); status/deliveredAt 随快照更新。
export interface SyncTrackInput {
  orderId: string
  company: string
  trackingNumber: string
  shippedAt: Date
}

export async function syncTrack(
  input: SyncTrackInput,
  provider: LogisticsProvider,
  client: DbClient,
  now = new Date(),
): Promise<Result<TrackSnapshot, 'PROVIDER_ERROR'>> {
  const snapshot = await provider.queryTrack({
    company: input.company,
    trackingNumber: input.trackingNumber,
    shippedAt: input.shippedAt,
    now,
  })
  if (snapshot.isErr()) return err(snapshot.error)
  const value = snapshot.value

  await client
    .insert(schema.logisticsTracks)
    .values({
      orderId: input.orderId,
      company: input.company,
      trackingNumber: input.trackingNumber,
      status: value.status,
      events: value.events,
      deliveredAt: value.deliveredAt ? new Date(value.deliveredAt) : null,
    })
    .onConflictDoUpdate({
      target: schema.logisticsTracks.orderId,
      set: {
        company: input.company,
        trackingNumber: input.trackingNumber,
        status: value.status,
        events: value.events,
        deliveredAt: value.deliveredAt ? new Date(value.deliveredAt) : null,
      },
    })
  return ok(value)
}

export async function getTrackByOrderId(orderId: string, client: DbClient) {
  const [track] = await client
    .select()
    .from(schema.logisticsTracks)
    .where(eq(schema.logisticsTracks.orderId, orderId))
    .limit(1)
  return track ?? null
}

// DB 行 → 响应形状: jsonb events 防御性收敛 + Date → ISO(镜像 payment 的 toPaymentRecord 模式)
export function toTrackResponse(track: typeof schema.logisticsTracks.$inferSelect) {
  return {
    company: track.company,
    trackingNumber: track.trackingNumber,
    status: track.status,
    events: toTrackEvents(track.events),
    deliveredAt: track.deliveredAt ? track.deliveredAt.toISOString() : null,
  }
}

// 收尾异常(拒收/派送失败)的订单 id: 这些订单禁止超时自动完成——
// 拒收单"自动完成"等于钱货两空, 正确动作是人工/后续编排触发退款。
// delivery_failed 若后续重派成功, 轨迹回到 delivered, 自然退出排除集。
export async function listExceptionOrderIds(client: DbClient): Promise<string[]> {
  const rows = await client
    .select({ orderId: schema.logisticsTracks.orderId })
    .from(schema.logisticsTracks)
    .where(inArray(schema.logisticsTracks.status, ['rejected', 'delivery_failed']))
  return rows.map((row) => row.orderId)
}
