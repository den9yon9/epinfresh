import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { markOrderRefunded, type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { insertOutboxEvent } from '@epinfresh/outbox'
import {
  cancelPendingPayment,
  confirmPayment,
  getPaymentById,
  getRefundByOutRefundNo,
  listStalePendingPayments,
  listStaleProcessingRefunds,
  markRefundAbnormal,
  markRefundSucceeded,
  type PaymentChannel,
  type PaymentGateway,
  type PaymentRecord,
  refundPayment,
  toPaymentRecord,
  type WebhookEvent,
} from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'
import { eq, or } from 'drizzle-orm'

export type ConfirmPaymentError = 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE' | 'ORDER_NOT_FOUND'

// 编排: 支付确认跨 payment + order 两域, 事务内保持原子。
// payment 域只改支付单; 订单 pending→paid 由 order 域状态机推进(CAS 防并发)。
// 同一事务内写 outbox("payment.succeeded"): 事件与业务状态同生共死, 由 worker 异步投递。
// 回调内 return err() 由 withTransaction 转为回滚: 订单非 pending(已被取消等)时
// 整个事务回滚, 支付单不会落 succeeded, outbox 也不产生事件。
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
    await insertOutboxEvent(tx, {
      eventType: 'payment.succeeded',
      aggregateType: 'payment',
      aggregateId: payment.id,
      payload: {
        orderId,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        paidAt: new Date().toISOString(),
      },
    })
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
  if (event.status !== 'succeeded') {
    // 退款通知: 走退款状态机
    if (event.status === 'refunded' && event.refundNo) {
      return confirmRefundByWebhookEvent(event, client)
    }
    return ok(null)
  }

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

// 退款通知处理: 定位退款单 → 金额比对(防伪) → 更新终态 → 成功时联动支付单 refunded + 订单 refunded。
// 幂等: 退款单/支付单已终态直接返回; 未知退款单确认消费(不阻塞渠道, 由对账兜底)。
// 金额不符返回 AMOUNT_MISMATCH: notify 路由回 400, 渠道稍后重试(与支付确认同一防伪原则)。
export async function confirmRefundByWebhookEvent(
  event: WebhookEvent,
  client: DbClient,
): Promise<Result<null, 'AMOUNT_MISMATCH'>> {
  const refundNo = event.refundNo ?? ''
  const located = await getRefundByOutRefundNo(refundNo, client)
  if (located.isErr()) return ok(null)

  const refund = located.value
  if (refund.status !== 'processing') return ok(null)

  // 事件金额与退款单不符 = 通知异常/伪造, 拒绝驱动状态
  if (event.amount !== refund.amount) return err('AMOUNT_MISMATCH')

  if (event.refundStatus === 'abnormal') {
    await markRefundAbnormal(refundNo, client)
    return ok(null)
  }

  // 退款成功: 退款单 succeeded + 支付单 refunded + 订单 refunded(订单已取消等终态则跳过)
  return withTransaction(client, async (tx) => {
    const updated = await markRefundSucceeded(
      refundNo,
      event.providerTransactionId ?? undefined,
      tx,
    )
    if (updated.isErr()) return ok(null)

    const paymentResult = await refundPayment(updated.value.paymentId, tx)
    if (paymentResult.isErr()) return ok(null)

    // 订单已 cancelled 等终态时跳过订单翻转, 退款仍成立
    await markOrderRefunded(updated.value.orderId, tx)
    return ok(null)
  })
}

export interface ReconcileOptions {
  staleAfterMs?: number
  limit?: number
}

export interface ReconcileResult {
  scanned: number
  fixedPaid: number
  closed: number
  // 跳过: 渠道不支持查询(mock)/查询失败/渠道侧未支付/确认或取消被并发抢占
  skipped: number
}

// 对账: 拉渠道侧交易状态 vs 本地长期 pending 的支付单, 修复漏回调/渠道关闭造成的漂移。
// 仅扫描渠道支持查询(实现了 queryPayment)的支付单; mock 无外部真值, 自动跳过。
// paid → 走与真实 webhook 相同的幂等确认管线(含 transaction_id 回填 + 金额校验 + 并发容忍);
// closed → 取消本地支付单(订单保持 pending, 用户可重新发起);
// unpaid/失败 → 保持原样, 下一轮再扫(幂等)。
export async function reconcilePendingPayments(
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  client: DbClient,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const staleAfterMs = opts.staleAfterMs ?? 30 * 60 * 1000
  const olderThan = new Date(Date.now() - staleAfterMs)
  const pending = await listStalePendingPayments(client, { olderThan, limit: opts.limit ?? 100 })
  const result: ReconcileResult = { scanned: 0, fixedPaid: 0, closed: 0, skipped: 0 }

  for (const payment of pending) {
    const provider = payment.provider as PaymentChannel
    const gateway = gateways[provider]
    if (!gateway?.queryPayment) {
      result.skipped += 1
      continue
    }
    result.scanned += 1

    const queried = await gateway.queryPayment(payment.outTradeNo)
    if (queried.isErr()) {
      result.skipped += 1
      continue
    }
    const state = queried.value

    if (state.status === 'paid') {
      const event: WebhookEvent = {
        channel: provider,
        eventId: crypto.randomUUID(),
        outTradeNo: payment.outTradeNo,
        providerTransactionId: state.providerTransactionId,
        amount: state.amount ?? payment.amount,
        status: 'succeeded',
      }
      const confirmed = await confirmByWebhookEvent(event, client)
      if (confirmed.isOk()) result.fixedPaid += 1
      else result.skipped += 1
      continue
    }

    if (state.status === 'closed') {
      const cancelled = await cancelPendingPayment(payment.id, client)
      if (cancelled.isOk()) result.closed += 1
      else result.skipped += 1
      continue
    }

    result.skipped += 1
  }
  return result
}

export interface ReconcileRefundsResult {
  scanned: number
  fixedSucceeded: number
  fixedAbnormal: number
  // 跳过: 渠道不支持退款查询/查询失败/渠道侧仍处理中/并发已终态
  skipped: number
}

// 退款对账: 渠道退款通知丢失时, 本地 processing 退款单会永久停留。
// 扫描超时仍 processing 的退款单 → refundQuery 渠道侧状态:
// succeeded → 合成退款通知事件走 confirmRefundByWebhookEvent 翻转终态;
// abnormal → 本地标 abnormal(可人工重试);
// processing/查询失败 → 下一轮再扫(幂等)。
export async function reconcilePendingRefunds(
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  client: DbClient,
  opts: ReconcileOptions = {},
): Promise<ReconcileRefundsResult> {
  const staleAfterMs = opts.staleAfterMs ?? 30 * 60 * 1000
  const olderThan = new Date(Date.now() - staleAfterMs)
  const stale = await listStaleProcessingRefunds(client, {
    olderThan,
    limit: opts.limit ?? 100,
  })
  const result: ReconcileRefundsResult = {
    scanned: 0,
    fixedSucceeded: 0,
    fixedAbnormal: 0,
    skipped: 0,
  }

  for (const refund of stale) {
    const payment = await getPaymentById(refund.paymentId, client)
    if (payment.isErr()) {
      result.skipped += 1
      continue
    }
    const provider = payment.value.provider as PaymentChannel
    const gateway = gateways[provider]
    if (!gateway?.refundQuery) {
      result.skipped += 1
      continue
    }
    result.scanned += 1

    const queried = await gateway.refundQuery({
      refundNo: refund.outRefundNo,
      outTradeNo: payment.value.outTradeNo,
    })
    if (queried.isErr()) {
      result.skipped += 1
      continue
    }
    const state = queried.value

    if (state.status === 'succeeded') {
      const event: WebhookEvent = {
        channel: provider,
        eventId: crypto.randomUUID(),
        outTradeNo: payment.value.outTradeNo,
        providerTransactionId: state.refundId,
        amount: refund.amount,
        status: 'refunded',
        refundNo: refund.outRefundNo,
        refundStatus: 'succeeded',
      }
      const confirmed = await confirmRefundByWebhookEvent(event, client)
      if (confirmed.isOk()) result.fixedSucceeded += 1
      else result.skipped += 1
      continue
    }

    if (state.status === 'abnormal') {
      const marked = await markRefundAbnormal(refund.outRefundNo, client)
      if (marked.isOk()) result.fixedAbnormal += 1
      else result.skipped += 1
      continue
    }

    result.skipped += 1
  }
  return result
}
