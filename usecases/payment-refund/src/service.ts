import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { markOrderRefunded, type OrderDetail } from '@epinfresh/order'
import {
  buildRefundNo,
  getRefundByOutRefundNo,
  insertRefund,
  type PaymentChannel,
  type PaymentGateway,
  type PaymentRecord,
  refundOrder,
  type RefundRecord,
  toPaymentRecord,
} from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq } from 'drizzle-orm'

export type RefundOrderError =
  | 'ORDER_NOT_FOUND'
  | 'NO_REFUNDABLE_PAYMENT'
  | 'INVALID_PAYMENT_STATE'
  | 'GATEWAY_ERROR'
  | 'UNSUPPORTED_CHANNEL'

export { buildRefundNo }

export type RefundOrderResult = { payment: PaymentRecord; order: OrderDetail; refund: RefundRecord }

// 编排: 退款跨 payment + order 两域, 并先向渠道网关提交退款。
// 顺序刻意"先外部后本地"; 渠道提交结果决定本地落地方式:
// - 同步成功(渠道返回 succeeded, mock/支付宝): 事务内翻转(payment refunded + order refunded) + 退款单 succeeded
// - 异步处理中(微信返回 processing): 只落退款单 processing, 订单/支付单保持不动,
//   最终结果由退款通知驱动(confirmRefundByWebhookEvent)
// 渠道提交失败则不改本地并返回 GATEWAY_ERROR; 重复提交(已存在退款单)返回 INVALID_PAYMENT_STATE。
export async function refundOrderWorkflow(
  orderId: string,
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  client: DbClient,
): Promise<Result<RefundOrderResult, RefundOrderError>> {
  // 事务外只读定位: 先校验订单可退款, 再定位可退款支付单(确定渠道、金额与退款编号)。
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

  const refundNo = buildRefundNo(payment.id)
  // 重复提交防护: 已有退款单(处理中/终态)直接拒绝, 避免渠道侧重复扣款
  const existing = await getRefundByOutRefundNo(refundNo, client)
  if (existing.isOk()) return err('INVALID_PAYMENT_STATE')

  const gateway = gateways[payment.provider as PaymentChannel]
  if (!gateway?.refund) return err('UNSUPPORTED_CHANNEL')

  const submitted = await gateway.refund({
    outTradeNo: payment.outTradeNo,
    refundNo,
    amount: payment.amount,
    total: payment.amount,
    currency: payment.currency,
  })
  if (submitted.isErr()) return err('GATEWAY_ERROR')

  // 异步渠道: 退款单 processing, 订单/支付单保持现状, 等退款通知
  if (submitted.value.status === 'processing') {
    const refund = await insertRefund(
      {
        paymentId: payment.id,
        orderId,
        outRefundNo: refundNo,
        amount: payment.amount,
        currency: payment.currency,
        providerRefundId: submitted.value.refundId,
      },
      client,
    )
    const items = await client
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
    return ok({ payment: toPaymentRecord(payment), order: { ...order, items }, refund })
  }

  // 同步渠道: 事务内翻转 + 退款单直接 succeeded
  return withTransaction(client, async (tx) => {
    const orderResult = await markOrderRefunded(orderId, tx)
    if (orderResult.isErr()) {
      return err(
        orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
      )
    }

    const paymentResult = await refundOrder(orderId, tx)
    if (paymentResult.isErr()) return err(paymentResult.error)

    const refund = await insertRefund(
      {
        paymentId: payment.id,
        orderId,
        outRefundNo: refundNo,
        amount: payment.amount,
        currency: payment.currency,
        status: 'succeeded',
        providerRefundId: submitted.value.refundId,
      },
      tx,
    )
    return ok({ payment: paymentResult.value, order: orderResult.value.order, refund })
  })
}
