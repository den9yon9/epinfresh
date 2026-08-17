import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { markOrderRefunded, type OrderDetail } from '@epinfresh/order'
import {
  type PaymentChannel,
  type PaymentGateway,
  type PaymentRecord,
  refundOrder,
} from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq } from 'drizzle-orm'

export type RefundOrderError =
  | 'ORDER_NOT_FOUND'
  | 'NO_REFUNDABLE_PAYMENT'
  | 'INVALID_PAYMENT_STATE'
  | 'GATEWAY_ERROR'
  | 'UNSUPPORTED_CHANNEL'

// 退款编号确定性派生自支付单 id: 同一支付单的重试使用相同 out_refund_no, 渠道侧幂等,
// 避免网络重放/本地翻转失败后重试产生重复退款。
export function buildRefundNo(paymentId: string): string {
  return `rf-${paymentId}`
}

// 编排: 退款跨 payment + order 两域, 并先向渠道网关提交退款。
// 顺序刻意"先外部后本地": 渠道退款成功后再事务内翻转本地(payment refunded + order refunded,
// CAS 防并发); 渠道提交失败则不改本地并返回 GATEWAY_ERROR, 不存在"本地已退、渠道未退"。
// 若渠道已提交而本地事务回滚(极端并发), 以相同 refundNo 重试会命中渠道幂等, 由对账兜底。
export async function refundOrderWorkflow(
  orderId: string,
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  client: DbClient,
): Promise<Result<{ payment: PaymentRecord; order: OrderDetail }, RefundOrderError>> {
  // 事务外只读定位: 先校验订单可退款, 再定位可退款支付单(确定渠道、金额与退款编号)。
  // 预检避免对不可退款订单误提交渠道退款。
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (!['paid', 'shipped', 'completed'].includes(order.status)) {
    return err('INVALID_PAYMENT_STATE')
  }
  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.status, 'succeeded')))
    .orderBy(schema.payments.createdAt)
    .limit(1)
  if (!payment) return err('NO_REFUNDABLE_PAYMENT')

  const gateway = gateways[payment.provider as PaymentChannel]
  if (!gateway?.refund) return err('UNSUPPORTED_CHANNEL')

  const submitted = await gateway.refund({
    outTradeNo: payment.outTradeNo,
    refundNo: buildRefundNo(payment.id),
    amount: payment.amount,
    total: payment.amount,
    currency: payment.currency,
  })
  if (submitted.isErr()) return err('GATEWAY_ERROR')

  return withTransaction(client, async (tx) => {
    const orderResult = await markOrderRefunded(orderId, tx)
    if (orderResult.isErr()) {
      return err(
        orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
      )
    }

    const paymentResult = await refundOrder(orderId, tx)
    if (paymentResult.isErr()) return err(paymentResult.error)

    return ok({ payment: paymentResult.value, order: orderResult.value.order })
  })
}
