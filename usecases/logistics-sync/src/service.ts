import { type DbClient } from '@epinfresh/database'
import {
  LOGISTICS_STALE_ALERT_DAYS,
  type LogisticsProvider,
  syncTrack,
  type SyncTrackInput,
} from '@epinfresh/logistics'
import { completeOrder, listShippedWithTracking } from '@epinfresh/order'

// 轨迹轮询编排: 圈定待查订单 → 逐单拉快照落库 → 已签收的 CAS 驱动订单完成。
// 域间禁止互调, order 与 logistics 的编排只能发生在这里(usecases)。
// completeOrder 带 CAS(shipped → completed), 与用户手点确认/admin 完成竞态安全。
export interface LogisticsSyncSummary {
  // 拉取快照成功的订单数
  polled: number
  // 快照显示已签收的订单数(含已被其他路径完成的)
  delivered: number
  // 本次由签收驱动 completed 的订单数(CAS 成功)
  autoCompleted: number
  // provider 查询失败的订单数(下轮重试, 不中断整批)
  failed: number
  // 收尾异常(拒收/派送失败)的订单数: 明确不自动完成, worker 记 warn 人工跟进
  exceptions: number
  // 发货超 STALE_ALERT_DAYS 仍未签收的订单数: 超时未签收预警
  staleNotDelivered: number
}

export async function pollAndSyncShippedOrders(
  client: DbClient,
  provider: LogisticsProvider,
  opts: { limit?: number; now?: Date } = {},
): Promise<LogisticsSyncSummary> {
  const summary: LogisticsSyncSummary = {
    polled: 0,
    delivered: 0,
    autoCompleted: 0,
    failed: 0,
    exceptions: 0,
    staleNotDelivered: 0,
  }
  const staleThresholdMs = LOGISTICS_STALE_ALERT_DAYS * 24 * 60 * 60 * 1000
  const orders = await listShippedWithTracking(client, opts.limit)

  for (const order of orders) {
    const now = opts.now ?? new Date()
    const input: SyncTrackInput = {
      orderId: order.id,
      company: order.courierCompany,
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt,
    }
    const snapshot = await syncTrack(input, provider, client, now)
    if (snapshot.isErr()) {
      summary.failed += 1
      continue
    }
    summary.polled += 1

    const { status, delivered } = snapshot.value
    if (status === 'rejected' || status === 'delivery_failed') {
      // 拒收/派送失败: 明确不自动完成(拒收单"完成"等于钱货两空), 计数供 worker 告警
      summary.exceptions += 1
      continue
    }

    if (delivered) {
      summary.delivered += 1
      const completed = await completeOrder(order.id, client)
      if (completed.isOk()) summary.autoCompleted += 1
      continue
    }

    // 超时未签收预警(签收/异常在上面分支已 continue, 不会误报)
    if (now.getTime() - order.shippedAt.getTime() > staleThresholdMs) {
      summary.staleNotDelivered += 1
    }
  }
  return summary
}
