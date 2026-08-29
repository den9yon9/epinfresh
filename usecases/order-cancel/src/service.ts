import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { insertOutboxEvent } from '@epinfresh/outbox'
import {
  getRefundByOutRefundNo,
  insertRefund,
  listPaymentsByOrder,
  nextRefundNo,
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
// - paid(已支付·未发货): 先向渠道网关提交全额退款(确定性退款号保证重试幂等), 再翻本地:
//   * 渠道同步成功(mock/支付宝): 事务内 订单 cancelled + 支付单 refunded + 退款单 succeeded + 恢复库存
//   * 渠道异步处理中(微信): 事务内 订单 cancelled + 退款单 processing + 恢复库存,
//     支付单保持 succeeded, 最终结果由退款通知驱动
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

    const refundNo = await nextRefundNo(succeeded.id, client)
    // 重复取消防护: 计算出的退款号已存在且非 abnormal(即非换号重试场景) → 拒绝
    const existing = await getRefundByOutRefundNo(refundNo, client)
    if (existing.isOk()) return err('INVALID_TRANSITION')

    const gateway = gateways[succeeded.provider as PaymentChannel]
    if (!gateway?.refund) return err('UNSUPPORTED_CHANNEL')
    const submitted = await gateway.refund({
      outTradeNo: succeeded.outTradeNo,
      refundNo,
      amount: succeeded.amount,
      total: succeeded.amount,
      currency: succeeded.currency,
    })
    if (submitted.isErr()) return err('GATEWAY_ERROR')
    const asyncRefund = submitted.value.status === 'processing'

    return withTransaction(client, async (tx) => {
      const cancelled = await updateOrderStatus(orderId, 'cancelled', tx)
      if (cancelled.isErr()) return err(cancelled.error)
      for (const item of cancelled.value.order.items) {
        const restored = await restoreProductStock(item.skuId, item.quantity, tx)
        if (restored.isErr()) {
          throw new Error(`restore stock failed for sku ${item.skuId}`)
        }
      }
      if (asyncRefund) {
        // 异步退款: 只挂退款单, 支付单保持 succeeded, 等退款通知翻转;
        // 此处不写 refund.succeeded 事件(状态未定), 成功时由退款通知漏斗统一补发
        await insertRefund(
          {
            paymentId: succeeded.id,
            orderId,
            outRefundNo: refundNo,
            amount: succeeded.amount,
            currency: succeeded.currency,
            providerRefundId: submitted.value.refundId,
          },
          tx,
        )
        return ok(cancelled.value.order)
      }
      const { items: payments } = await listPaymentsByOrder(orderId, tx)
      for (const payment of payments) {
        if (payment.status === 'succeeded') {
          const refunded = await refundPayment(payment.id, tx)
          if (refunded.isErr()) {
            throw new Error(`refund failed for payment ${payment.id}`)
          }
        }
      }
      const refund = await insertRefund(
        {
          paymentId: succeeded.id,
          orderId,
          outRefundNo: refundNo,
          amount: succeeded.amount,
          currency: succeeded.currency,
          status: 'succeeded',
          providerRefundId: submitted.value.refundId,
        },
        tx,
      )
      // 同步渠道(mock/支付宝)退款成功事件与取消/翻转同事务
      await insertOutboxEvent(tx, {
        eventType: 'refund.succeeded',
        aggregateType: 'refund',
        aggregateId: refund.id,
        payload: {
          refundNo: refund.outRefundNo,
          paymentId: succeeded.id,
          orderId,
          amount: succeeded.amount,
          currency: succeeded.currency,
          refundedAt: new Date().toISOString(),
        },
      })
      return ok(cancelled.value.order)
    })
  }

  return withTransaction(client, async (tx) => {
    const result = await updateOrderStatus(orderId, 'cancelled', tx)
    if (result.isErr()) {
      return err(result.error)
    }
    const { order } = result.value
    for (const item of order.items) {
      const restored = await restoreProductStock(item.skuId, item.quantity, tx)
      if (restored.isErr()) {
        throw new Error(`restore stock failed for sku ${item.skuId}`)
      }
    }
    return ok(order)
  })
}
