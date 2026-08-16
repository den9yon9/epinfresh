import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import {
  confirmPayment,
  type PaymentRecord,
  toPaymentRecord,
  type WebhookEvent,
} from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'
import { eq, or } from 'drizzle-orm'

export type ConfirmPaymentError = 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE' | 'ORDER_NOT_FOUND'

// 编排: 支付确认跨 payment + order 两域, 事务内保持原子。
// payment 域只改支付单; 订单 pending→paid 由 order 域状态机推进(CAS 防并发)。
// 回调内 return err() 由 withTransaction 转为回滚: 订单非 pending(已被取消等)时
// 整个事务回滚, 支付单不会落 succeeded。
export async function confirmOrderPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<{ payment: typeof schema.payments.$inferSelect; order: OrderDetail }, ConfirmPaymentError>
> {
  return withTransaction(client, async (tx) => {
    const paymentResult = await confirmPayment(paymentId, tx)
    if (paymentResult.isErr()) return err(paymentResult.error)
    const { payment, orderId } = paymentResult.value

    const orderResult = await updateOrderStatus(orderId, 'paid', tx)
    if (orderResult.isErr()) {
      return err(
        orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
      )
    }
    return ok({ payment, order: orderResult.value.order })
  })
}

export type WebhookConfirmError =
  'PAYMENT_NOT_FOUND' | 'AMOUNT_MISMATCH' | 'INVALID_PAYMENT_STATE' | 'ORDER_NOT_FOUND'

// webhook 入口: 渠道回调事件 → 幂等确认支付。
// 定位/金额校验/回填在事务外(只读+单语句原子), 状态推进复用 confirmOrderPayment 自带事务,
// 避免嵌套 withTransaction; 并发重复回调由 CAS 败者重查容忍为幂等成功。
export async function confirmByWebhookEvent(
  event: WebhookEvent,
  client: DbClient,
): Promise<Result<{ payment: PaymentRecord } | null, WebhookConfirmError>> {
  // M1 只处理成功事件; 退款等其它事件先确认消费, 不落状态
  if (event.status !== 'succeeded') return ok(null)

  // 定位支付单: 优先渠道交易号, 兜底商户订单号。
  // 真实渠道回调自带 transaction_id; mock 在确认时才回填, 首次回调靠 out_trade_no 命中。
  const conditions = event.providerTransactionId
    ? [
        eq(schema.payments.providerTransactionId, event.providerTransactionId),
        eq(schema.payments.outTradeNo, event.outTradeNo),
      ]
    : [eq(schema.payments.outTradeNo, event.outTradeNo)]
  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(or(...conditions))
    .orderBy(schema.payments.createdAt)
    .limit(1)
  if (!payment) return err('PAYMENT_NOT_FOUND')

  // 幂等: 已确认成功直接返回, 不重复推进订单状态
  if (payment.status === 'succeeded') return ok({ payment: toPaymentRecord(payment) })

  // 金额不符 = 伪造回调风险, 拒绝确认
  if (payment.amount !== event.amount) return err('AMOUNT_MISMATCH')

  if (
    event.providerTransactionId !== undefined &&
    payment.providerTransactionId !== event.providerTransactionId
  ) {
    await client
      .update(schema.payments)
      .set({ providerTransactionId: event.providerTransactionId })
      .where(eq(schema.payments.id, payment.id))
  }

  const confirmed = await confirmOrderPayment(payment.id, client)
  if (confirmed.isOk()) return ok({ payment: toPaymentRecord(confirmed.value.payment) })

  // 并发重复回调: 状态推进 CAS 败给另一笔成功, 视为幂等成功
  const [current] = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, payment.id))
  if (current?.status === 'succeeded') return ok({ payment: toPaymentRecord(current) })
  return err(confirmed.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE')
}
