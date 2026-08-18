import { type DbClient, type PaymentStatus, type RefundStatus, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, desc, eq, lt } from 'drizzle-orm'

import { type PaymentGateway, type PaymentPayload } from './gateway'

// 域边界统一返回 payload 已类型化的支付单; jsonb 列的原始类型是 unknown
export type PaymentRecord = Omit<typeof schema.payments.$inferSelect, 'payload'> & {
  payload: PaymentPayload | null
}

export function toPaymentRecord(payment: typeof schema.payments.$inferSelect): PaymentRecord {
  return { ...payment, payload: payment.payload as PaymentPayload | null }
}

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['succeeded', 'failed', 'cancelled'],
  succeeded: ['refunded'],
  failed: [],
  refunded: [],
  cancelled: [],
}

export async function initiatePayment(
  orderId: string,
  gateway: PaymentGateway,
  client: DbClient,
  channelContext?: Record<string, unknown>,
): Promise<
  Result<
    { payment: PaymentRecord; payload: PaymentPayload },
    'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'GATEWAY_ERROR'
  >
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (order.status !== 'pending') return err('ORDER_NOT_PENDING')

  // 幂等复用: 已存在且已拿到渠道参数的 pending 支付单直接返回
  const [existing] = await client
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.status, 'pending')))
    .orderBy(schema.payments.createdAt)
    .limit(1)
  if (existing?.payload)
    return ok({ payment: toPaymentRecord(existing), payload: existing.payload as PaymentPayload })
  if (existing) {
    // 上次下单在拿到渠道参数前失败, 作废旧单再新建
    await client
      .update(schema.payments)
      .set({ status: 'failed' })
      .where(and(eq(schema.payments.id, existing.id), eq(schema.payments.status, 'pending')))
  }

  const outTradeNo = crypto.randomUUID().replace(/-/g, '')
  const [created] = await client
    .insert(schema.payments)
    .values({
      orderId,
      amount: order.totalAmount,
      currency: order.currency,
      status: 'pending',
      provider: gateway.channel,
      outTradeNo,
    })
    .returning()

  const initiated = await gateway.createPayment({
    outTradeNo,
    orderId,
    amount: order.totalAmount,
    currency: order.currency,
    description: `一品鲜订单 ${order.id.slice(0, 8)}`,
    channelContext,
  })
  if (initiated.isErr()) {
    await client
      .update(schema.payments)
      .set({ status: 'failed' })
      .where(and(eq(schema.payments.id, created.id), eq(schema.payments.status, 'pending')))
    return err('GATEWAY_ERROR')
  }
  const { providerRef, payload } = initiated.value
  const [payment] = await client
    .update(schema.payments)
    .set({ providerRef, payload })
    .where(and(eq(schema.payments.id, created.id), eq(schema.payments.status, 'pending')))
    .returning()
  return ok({ payment: toPaymentRecord(payment), payload })
}

export async function getPaymentById(
  paymentId: string,
  client: DbClient,
): Promise<Result<PaymentRecord, 'PAYMENT_NOT_FOUND'>> {
  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
  if (!payment) return err('PAYMENT_NOT_FOUND')
  return ok(toPaymentRecord(payment))
}

// 退款编号确定性派生自支付单 id: 同一支付单的重试使用相同 out_refund_no, 渠道侧幂等,
// 避免网络重放/本地翻转失败后重试产生重复退款。退款编排(usecases)与订单取消共用。
export function buildRefundNo(paymentId: string): string {
  return `rf-${paymentId}`
}

// 事务原语: 不自己开事务, 在传入的 client 上执行(事务边界归 usecase 持有);
// 单条 CAS update 自带原子性, 跨域原子性由 payment-confirm/refund 用例编排。
export async function confirmPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<{ payment: PaymentRecord; orderId: string }, 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'>
> {
  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
  if (!payment) return err('PAYMENT_NOT_FOUND')
  if (!PAYMENT_TRANSITIONS[payment.status].includes('succeeded'))
    return err('INVALID_PAYMENT_STATE')

  const [updated] = await client
    .update(schema.payments)
    .set({ status: 'succeeded' })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, payment.status)))
    .returning()
  if (!updated) return err('INVALID_PAYMENT_STATE')

  return ok({ payment: toPaymentRecord(updated), orderId: payment.orderId })
}

export async function refundPayment(
  paymentId: string,
  client: DbClient,
): Promise<Result<PaymentRecord, 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'>> {
  const [payment] = await client
    .update(schema.payments)
    .set({ status: 'refunded' })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'succeeded')))
    .returning()
  if (!payment) {
    const existing = await client
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
    if (!existing[0]) return err('PAYMENT_NOT_FOUND')
    return err('INVALID_PAYMENT_STATE')
  }
  return ok(toPaymentRecord(payment))
}

export async function refundOrder(
  orderId: string,
  client: DbClient,
): Promise<
  Result<PaymentRecord, 'ORDER_NOT_FOUND' | 'NO_REFUNDABLE_PAYMENT' | 'INVALID_PAYMENT_STATE'>
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')

  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.status, 'succeeded')))
    .orderBy(schema.payments.createdAt)
    .limit(1)
  if (!payment) return err('NO_REFUNDABLE_PAYMENT')

  const [refunded] = await client
    .update(schema.payments)
    .set({ status: 'refunded' })
    .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, 'succeeded')))
    .returning()
  if (!refunded) return err('INVALID_PAYMENT_STATE')

  return ok(toPaymentRecord(refunded))
}

// 订单支付记录: 支付单 + 退款单(异步退款状态展示用)。refunds 按创建时间倒序。
export async function listPaymentsByOrder(orderId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(schema.payments.createdAt)
  const refunds = await client
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId))
    .orderBy(desc(schema.refunds.createdAt))
  return { items: items.map(toPaymentRecord), refunds }
}

// --- 退款单(refunds)事务原语: 真实渠道(微信)退款异步, 提交落 processing, 通知驱动终态 ---

export type RefundRecord = typeof schema.refunds.$inferSelect

export async function insertRefund(
  input: {
    paymentId: string
    orderId: string
    outRefundNo: string
    amount: string
    currency: string
    status?: RefundStatus
    providerRefundId?: string
  },
  client: DbClient,
): Promise<RefundRecord> {
  const [row] = await client
    .insert(schema.refunds)
    .values({
      paymentId: input.paymentId,
      orderId: input.orderId,
      outRefundNo: input.outRefundNo,
      amount: input.amount,
      currency: input.currency,
      status: input.status ?? 'processing',
      providerRefundId: input.providerRefundId,
    })
    .returning()
  return row
}

// 退款单 CAS: processing → succeeded(退款通知成功 / 同步渠道直接落终态)
export async function markRefundSucceeded(
  outRefundNo: string,
  providerRefundId: string | undefined,
  client: DbClient,
): Promise<Result<RefundRecord, 'REFUND_NOT_FOUND' | 'INVALID_REFUND_STATE'>> {
  const [updated] = await client
    .update(schema.refunds)
    .set({ status: 'succeeded', providerRefundId })
    .where(
      and(eq(schema.refunds.outRefundNo, outRefundNo), eq(schema.refunds.status, 'processing')),
    )
    .returning()
  if (!updated) {
    const existing = await getRefundByOutRefundNo(outRefundNo, client)
    if (existing.isErr()) return err('REFUND_NOT_FOUND')
    return err('INVALID_REFUND_STATE')
  }
  return ok(updated)
}

// 退款单 CAS: processing → abnormal(渠道退款失败通知)
export async function markRefundAbnormal(
  outRefundNo: string,
  client: DbClient,
): Promise<Result<RefundRecord, 'REFUND_NOT_FOUND' | 'INVALID_REFUND_STATE'>> {
  const [updated] = await client
    .update(schema.refunds)
    .set({ status: 'abnormal' })
    .where(
      and(eq(schema.refunds.outRefundNo, outRefundNo), eq(schema.refunds.status, 'processing')),
    )
    .returning()
  if (!updated) {
    const existing = await getRefundByOutRefundNo(outRefundNo, client)
    if (existing.isErr()) return err('REFUND_NOT_FOUND')
    return err('INVALID_REFUND_STATE')
  }
  return ok(updated)
}

export async function getRefundByOutRefundNo(
  outRefundNo: string,
  client: DbClient,
): Promise<Result<RefundRecord, 'REFUND_NOT_FOUND'>> {
  const [row] = await client
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.outRefundNo, outRefundNo))
  if (!row) return err('REFUND_NOT_FOUND')
  return ok(row)
}

export async function listRefundsByPayment(paymentId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.paymentId, paymentId))
    .orderBy(desc(schema.refunds.createdAt))
  return { items }
}

// 对账用: 列出创建时间早于 olderThan 仍 pending 的支付单(疑似漏回调/渠道已关闭)。
// 只关心这批, 已终态的不再扫描。
export async function listStalePendingPayments(
  client: DbClient,
  opts: { olderThan: Date; limit?: number },
): Promise<PaymentRecord[]> {
  const rows = await client
    .select()
    .from(schema.payments)
    .where(
      and(eq(schema.payments.status, 'pending'), lt(schema.payments.createdAt, opts.olderThan)),
    )
    .orderBy(schema.payments.createdAt)
    .limit(opts.limit ?? 100)
  return rows.map(toPaymentRecord)
}

// 事务原语: 对账发现渠道侧订单已关闭时, 把 pending 支付单置为 cancelled(CAS 防竞态)。
// 订单本身保持 pending, 用户可重新发起支付。
export async function cancelPendingPayment(
  paymentId: string,
  client: DbClient,
): Promise<Result<PaymentRecord, 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'>> {
  const [updated] = await client
    .update(schema.payments)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'pending')))
    .returning()
  if (!updated) {
    const existing = await client
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
    if (!existing[0]) return err('PAYMENT_NOT_FOUND')
    return err('INVALID_PAYMENT_STATE')
  }
  return ok(toPaymentRecord(updated))
}
