import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import {
  buildRefundNo,
  listPaymentsByOrder,
  type PaymentChannel,
  type PaymentGateway,
  refundPayment,
} from '@epinfresh/payment'
import { restoreProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'
import { eq } from 'drizzle-orm'

export type CancelOrderError =
  'ORDER_NOT_FOUND' | 'INVALID_TRANSITION' | 'GATEWAY_ERROR' | 'UNSUPPORTED_CHANNEL'

// 取消订单语义细分(2026-08-18):
// - pending(未支付): 直接取消, 恢复库存, 无支付动作
// - paid(已支付·未发货): 先向渠道网关提交全额退款(确定性退款号保证重试幂等),
//   成功后再事务内翻转本地(订单 cancelled + 支付单 refunded + 恢复库存)。
//   "先渠道后本地"避免"本地已退、渠道未退"分叉; 渠道失败不改本地。
// - shipped/completed: 状态机禁止取消, 退款仅走 admin 退款接口
export async function cancelOrder(
  orderId: string,
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  client: DbClient,
): Promise<Result<OrderDetail, CancelOrderError>> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')

  if (order.status === 'paid') {
    const { items: payments } = await listPaymentsByOrder(orderId, client)
    const succeeded = payments.find((p) => p.status === 'succeeded')
    if (!succeeded) return err('INVALID_TRANSITION')

    const gateway = gateways[succeeded.provider as PaymentChannel]
    if (!gateway?.refund) return err('UNSUPPORTED_CHANNEL')
    const submitted = await gateway.refund({
      outTradeNo: succeeded.outTradeNo,
      refundNo: buildRefundNo(succeeded.id),
      amount: succeeded.amount,
      total: succeeded.amount,
      currency: succeeded.currency,
    })
    if (submitted.isErr()) return err('GATEWAY_ERROR')
  }

  return withTransaction(client, async (tx) => {
    const result = await updateOrderStatus(orderId, 'cancelled', tx)
    if (result.isErr()) {
      return err(result.error)
    }
    const { from, order } = result.value
    for (const item of order.items) {
      const restored = await restoreProductStock(item.skuId, item.quantity, tx)
      if (restored.isErr()) {
        throw new Error(`restore stock failed for sku ${item.skuId}`)
      }
    }
    if (from === 'paid') {
      const { items: payments } = await listPaymentsByOrder(orderId, tx)
      for (const payment of payments) {
        if (payment.status === 'succeeded') {
          const refunded = await refundPayment(payment.id, tx)
          if (refunded.isErr()) {
            throw new Error(`refund failed for payment ${payment.id}`)
          }
        }
      }
    }
    return ok(order)
  })
}
