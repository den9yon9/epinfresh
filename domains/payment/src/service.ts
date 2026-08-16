import { type DbClient, type PaymentStatus, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq } from 'drizzle-orm'

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

export async function listPaymentsByOrder(orderId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(schema.payments.createdAt)
  return { items: items.map(toPaymentRecord) }
}
