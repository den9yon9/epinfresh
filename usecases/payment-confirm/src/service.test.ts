import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createMockPaymentGateway, initiatePayment } from '@epinfresh/payment'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { confirmOrderPayment } from './service'

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
  return payment
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
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'INVALID_PAYMENT_STATE' })

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })

  test('returns PAYMENT_NOT_FOUND for unknown payment', async () => {
    const result = await confirmOrderPayment('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'PAYMENT_NOT_FOUND' })
  })

  test('rejects confirming an already succeeded payment', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)
    await confirmOrderPayment(payment.id, db)

    const again = await confirmOrderPayment(payment.id, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toMatchObject({ code: 'INVALID_PAYMENT_STATE' })
  })
})
