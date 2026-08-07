import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  confirmPayment,
  createMockPaymentGateway,
  failPayment,
  initiatePayment,
  listPaymentsByOrder,
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

  test('confirming payment transitions the order to paid', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()

    const result = await confirmPayment(payment.id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().payment.status).toBe('succeeded')

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
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

  test('failed payment does not touch the order', async () => {
    const order = await seedOrder()
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()

    const failed = await failPayment(payment.id, db)
    expect(failed.isOk()).toBe(true)
    expect(failed._unsafeUnwrap().status).toBe('failed')

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('pending')
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
})
