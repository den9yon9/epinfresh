import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  confirmPayment,
  createMockPaymentGateway,
  initiatePayment,
  listPaymentsByOrder,
  refundOrder,
  refundPayment,
} from './service'

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

async function seedOrder(amount = '25.00') {
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

describe('payment domain', () => {
  test('initiates a pending payment with provider ref', async () => {
    const order = await seedOrder()
    const result = await initiatePayment(order.id, createMockPaymentGateway(), db)

    expect(result.isOk()).toBe(true)
    const payment = result._unsafeUnwrap()
    expect(payment.orderId).toBe(order.id)
    expect(payment.status).toBe('pending')
    expect(payment.amount).toBe('25.00')
    expect(payment.provider).toBe('mock')
    expect(payment.providerRef).toMatch(/^mock-/)
  })

  test('rejects payment for non-pending order', async () => {
    const order = await seedOrder()
    await db.update(schema.orders).set({ status: 'shipped' }).where(eq(schema.orders.id, order.id))

    const result = await initiatePayment(order.id, createMockPaymentGateway(), db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_PENDING')
  })

  test('confirming payment marks the payment succeeded', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()

    const result = await confirmPayment(payment.id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().payment.status).toBe('succeeded')
  })

  test('confirming twice is rejected', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()
    await confirmPayment(payment.id, db)

    const again = await confirmPayment(payment.id, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('refunds a succeeded payment', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()
    await confirmPayment(payment.id, db)

    const refunded = await refundPayment(payment.id, db)
    expect(refunded.isOk()).toBe(true)
    expect(refunded._unsafeUnwrap().status).toBe('refunded')
  })

  test('cannot refund a pending payment', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()

    const refunded = await refundPayment(payment.id, db)
    expect(refunded.isErr()).toBe(true)
    expect(refunded._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('lists payments by order', async () => {
    const order = await seedOrder()
    await initiatePayment(order.id, createMockPaymentGateway(), db)

    const { items } = await listPaymentsByOrder(order.id, db)
    expect(items).toHaveLength(1)
  })

  test('refundOrder refunds the succeeded payment', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()
    await confirmPayment(payment.id, db)

    const result = await refundOrder(order.id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('refunded')
  })

  test('refundOrder returns NO_REFUNDABLE_PAYMENT without a succeeded payment', async () => {
    const order = await seedOrder()
    await db.update(schema.orders).set({ status: 'paid' }).where(eq(schema.orders.id, order.id))
    await initiatePayment(order.id, createMockPaymentGateway(), db)

    const result = await refundOrder(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('NO_REFUNDABLE_PAYMENT')
  })

  test('refundOrder returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await refundOrder('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })
})
