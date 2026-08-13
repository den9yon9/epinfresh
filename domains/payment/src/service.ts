import { type DbClient, type PaymentStatus, schema, withTransaction } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq } from 'drizzle-orm'

// TODO(payment): 暂无商户账号, 暂用 mock; 申请到微信/支付宝商户号后接入真实网关 —
// 实现 PaymentGateway 契约(charge/回调), confirm 逻辑挪到 webhook handler,
// 域内 service 函数保持不变; mock 当前同步成功
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
    { payment: typeof schema.payments.$inferSelect; orderId: string },
    'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE'
  >
> {
  return withTransaction(client, async (tx) => {
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

    return ok({ payment: updated, orderId: payment.orderId })
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

export async function refundOrder(
  orderId: string,
  client: DbClient,
): Promise<
  Result<
    typeof schema.payments.$inferSelect,
    'ORDER_NOT_FOUND' | 'NO_REFUNDABLE_PAYMENT' | 'INVALID_PAYMENT_STATE'
  >
> {
  return withTransaction(client, async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    if (!order) return err('ORDER_NOT_FOUND')

    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.status, 'succeeded')))
      .orderBy(schema.payments.createdAt)
      .limit(1)
    if (!payment) return err('NO_REFUNDABLE_PAYMENT')

    const [refunded] = await tx
      .update(schema.payments)
      .set({ status: 'refunded' })
      .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, 'succeeded')))
      .returning()
    if (!refunded) return err('INVALID_PAYMENT_STATE')

    return ok(refunded)
  })
}

export async function listPaymentsByOrder(orderId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(schema.payments.createdAt)
  return { items }
}
