import { type DbClient, type PaymentStatus, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq } from 'drizzle-orm'

// ponytail: 接缝 — 真实支付网关（微信/支付宝等）实现该契约后，confirm 逻辑挪到 webhook handler，
// 域内 service 函数保持不变；mock 当前同步成功
export interface PaymentGateway {
  charge(input: { orderId: string; amount: string; currency: string }): Promise<{
    providerRef: string
  }>
}

export function createMockPaymentGateway(): PaymentGateway {
  return {
    // ponytail: mock 忽略入参直接成功；真实网关在此调用第三方 API
    async charge() {
      return { providerRef: `mock-${crypto.randomUUID()}` }
    },
  }
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
): Promise<Result<typeof schema.payments.$inferSelect, 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING'>> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (order.status !== 'pending') return err('ORDER_NOT_PENDING')

  const { providerRef } = await gateway.charge({
    orderId,
    amount: order.totalAmount,
    currency: order.currency,
  })

  const [payment] = await client
    .insert(schema.payments)
    .values({
      orderId,
      amount: order.totalAmount,
      currency: order.currency,
      status: 'pending',
      provider: 'mock',
      providerRef,
    })
    .returning()
  return ok(payment)
}

export async function getPaymentById(
  paymentId: string,
  client: DbClient,
): Promise<Result<typeof schema.payments.$inferSelect, 'PAYMENT_NOT_FOUND'>> {
  const [payment] = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
  if (!payment) return err('PAYMENT_NOT_FOUND')
  return ok(payment)
}

export async function confirmPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<
    { payment: typeof schema.payments.$inferSelect; orderStatus: string },
    'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'
  >
> {
  return client.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
    if (!payment) return err('PAYMENT_NOT_FOUND')
    if (!PAYMENT_TRANSITIONS[payment.status].includes('succeeded'))
      return err('INVALID_PAYMENT_STATE')

    const [updated] = await tx
      .update(schema.payments)
      .set({ status: 'succeeded' })
      .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, payment.status)))
      .returning()
    if (!updated) return err('INVALID_PAYMENT_STATE')

    const [order] = await tx
      .update(schema.orders)
      .set({ status: 'paid' })
      .where(and(eq(schema.orders.id, payment.orderId), eq(schema.orders.status, 'pending')))
      .returning()
    if (!order) return err('INVALID_PAYMENT_STATE')

    return ok({ payment: updated, orderStatus: order.status })
  })
}

export async function failPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<typeof schema.payments.$inferSelect, 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'>
> {
  const [payment] = await client
    .update(schema.payments)
    .set({ status: 'failed' })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'pending')))
    .returning()
  if (!payment) {
    const existing = await client
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
    if (!existing[0]) return err('PAYMENT_NOT_FOUND')
    return err('INVALID_PAYMENT_STATE')
  }
  return ok(payment)
}

export async function refundPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<typeof schema.payments.$inferSelect, 'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'>
> {
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
  return ok(payment)
}

export async function listPaymentsByOrder(orderId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(schema.payments.createdAt)
  return { items }
}
