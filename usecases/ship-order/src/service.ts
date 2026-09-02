import { type DbClient, withTransaction } from '@epinfresh/database'
import { type OrderDetail, shipOrder as shipOrderInTx } from '@epinfresh/order'
import { insertOutboxEvent } from '@epinfresh/outbox'
import { err, ok, type Result } from '@epinfresh/shared'

export type ShipOrderError = 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION' | 'SHIPMENT_INFO_INCOMPLETE'

// 编排: 发货(order 域 CAS 状态流转) + order.shipped 事件写入, 同一事务原子提交。
// 事件写入是本用例的固定步骤(不再经由域函数的可选回调)——任何发货入口只要走
// 本用例, 事件就不可能被遗漏。仅 paid → shipped 真实转变发事件(补录/改号不重发邮件)。
export async function shipOrder(
  orderId: string,
  trackingNumber: string | undefined,
  courierCompany: string | undefined,
  client: DbClient,
): Promise<Result<OrderDetail, ShipOrderError>> {
  return withTransaction(client, async (tx) => {
    const result = await shipOrderInTx(orderId, trackingNumber, courierCompany, tx)
    if (result.isErr()) return err(result.error)
    const { order, from } = result.value
    if (from === 'paid') {
      await insertOutboxEvent(tx, {
        eventType: 'order.shipped',
        aggregateType: 'order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          shippedAt: (order.shippedAt ?? new Date()).toISOString(),
          courierCompany: order.courierCompany,
        },
      })
    }
    return ok(order)
  })
}
