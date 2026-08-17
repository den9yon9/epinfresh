import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createMockPaymentGateway, initiatePayment } from '@epinfresh/payment'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { confirmByWebhookEvent, confirmOrderPayment } from './service'

let db: Db

beforeAll(async () => {
  db = await prepareTestDb()
})

afterAll(async () => {
  if (db) await closeDb(db)
})

beforeEach(async () => {
  await resetDb(db)
})

async function seedPendingOrder(amount = '25.00') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email: 'alice@example.com', passwordHash: 'not-a-real-hash' })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status: 'pending', totalAmount: amount })
    .returning()
  return order
}

async function seedPayment(orderId: string) {
  const payment = (await initiatePayment(orderId, createMockPaymentGateway(), db))._unsafeUnwrap()
  return payment.payment
}

describe('confirmOrderPayment', () => {
  test('confirms payment and transitions the order to paid atomically', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)

    const result = await confirmOrderPayment(payment.id, db)
    expect(result.isOk()).toBe(true)

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
  })

  test('rejects confirmation when the order is no longer pending and rolls back', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)
    // 订单已被取消(或其他状态), 支付确认应整体回滚
    await db
      .update(schema.orders)
      .set({ status: 'cancelled' })
      .where(eq(schema.orders.id, order.id))

    const result = await confirmOrderPayment(payment.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })

  test('returns PAYMENT_NOT_FOUND for unknown payment', async () => {
    const result = await confirmOrderPayment('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PAYMENT_NOT_FOUND')
  })

  test('rejects confirming an already succeeded payment', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)
    await confirmOrderPayment(payment.id, db)

    const again = await confirmOrderPayment(payment.id, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('writes a payment.succeeded outbox event in the same transaction', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)

    const result = await confirmOrderPayment(payment.id, db)
    expect(result.isOk()).toBe(true)

    const [event] = await db.select().from(schema.outboxEvents)
    expect(event.eventType).toBe('payment.succeeded')
    expect(event.aggregateType).toBe('payment')
    expect(event.aggregateId).toBe(payment.id)
    expect(event.status).toBe('pending')
    expect(event.payload).toMatchObject({ orderId: order.id, paymentId: payment.id })
  })

  test('does not write an outbox event when confirmation rolls back', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)
    await db
      .update(schema.orders)
      .set({ status: 'cancelled' })
      .where(eq(schema.orders.id, order.id))

    const result = await confirmOrderPayment(payment.id, db)
    expect(result.isErr()).toBe(true)

    const events = await db.select().from(schema.outboxEvents)
    expect(events).toHaveLength(0)
  })
})

describe('confirmByWebhookEvent', () => {
  async function seedWebhookPayment(amount = '25.00') {
    const order = await seedPendingOrder(amount)
    const payment = await seedPayment(order.id)
    return { order, payment }
  }

  function succeededEvent(payment: typeof schema.payments.$inferSelect) {
    return {
      channel: 'mock' as const,
      eventId: crypto.randomUUID(),
      outTradeNo: payment.outTradeNo,
      providerTransactionId: payment.providerRef as string,
      amount: payment.amount,
      status: 'succeeded' as const,
    }
  }

  test('confirms payment by provider transaction id and marks the order paid', async () => {
    const { order, payment } = await seedWebhookPayment()

    const result = await confirmByWebhookEvent(succeededEvent(payment), db)
    expect(result.isOk()).toBe(true)

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(afterPayment.providerTransactionId).toBe(payment.providerRef)
  })

  test('locates the payment by out trade no when provider transaction id is missing', async () => {
    const { order, payment } = await seedWebhookPayment()
    const event = succeededEvent(payment)
    const { providerTransactionId: _ignored, ...eventWithoutTxId } = event

    const result = await confirmByWebhookEvent(eventWithoutTxId, db)
    expect(result.isOk()).toBe(true)

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
  })

  test('is idempotent on duplicate callbacks', async () => {
    const { order, payment } = await seedWebhookPayment()
    const event = succeededEvent(payment)

    await confirmByWebhookEvent(event, db)
    const again = await confirmByWebhookEvent(event, db)
    expect(again.isOk()).toBe(true)

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
  })

  test('writes exactly one outbox event across duplicate callbacks', async () => {
    const { payment } = await seedWebhookPayment()
    const event = succeededEvent(payment)

    await confirmByWebhookEvent(event, db)
    await confirmByWebhookEvent(event, db)

    const events = await db.select().from(schema.outboxEvents)
    expect(events).toHaveLength(1)
  })

  test('rejects a webhook event with mismatched amount', async () => {
    const { order, payment } = await seedWebhookPayment()
    const event = { ...succeededEvent(payment), amount: '999.99' }

    const result = await confirmByWebhookEvent(event, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('AMOUNT_MISMATCH')

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('pending')
  })

  test('returns PAYMENT_NOT_FOUND for unknown payment', async () => {
    const result = await confirmByWebhookEvent(
      {
        channel: 'mock',
        eventId: crypto.randomUUID(),
        outTradeNo: 'unknown-out-trade-no',
        providerTransactionId: 'unknown-transaction-id',
        amount: '25.00',
        status: 'succeeded',
      },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PAYMENT_NOT_FOUND')
  })

  test('acknowledges non-succeeded events without changing state', async () => {
    const { order, payment } = await seedWebhookPayment()
    const event = { ...succeededEvent(payment), status: 'refunded' as const }

    const result = await confirmByWebhookEvent(event, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('pending')
  })
})
