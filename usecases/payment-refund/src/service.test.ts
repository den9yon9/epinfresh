import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { updateOrderStatus } from '@epinfresh/order'
import { createMockPaymentGateway, initiatePayment } from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { refundOrderWorkflow } from './service'

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

async function seedOrder(status: 'pending' | 'paid' | 'shipped' | 'completed' = 'pending') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email: 'alice@example.com', passwordHash: 'not-a-real-hash' })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status, totalAmount: '25.00' })
    .returning()
  return order
}

async function seedPaidOrderWithPayment() {
  // 订单须从 pending 发起支付, 再经支付确认联动为 paid
  const order = await seedOrder('pending')
  const payment = (await initiatePayment(order.id, createMockPaymentGateway(), db))._unsafeUnwrap()
  const confirmed = await confirmOrderPayment(payment.id, db)
  if (confirmed.isErr()) throw new Error('seed confirm failed')
  return { order, payment }
}

describe('refundOrderWorkflow', () => {
  test('refunds the payment and marks the order refunded atomically', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()

    const result = await refundOrderWorkflow(order.id, db)
    expect(result.isOk()).toBe(true)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')
  })

  test('rejects refunding a pending order', async () => {
    const order = await seedOrder('pending')

    const result = await refundOrderWorkflow(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'INVALID_PAYMENT_STATE' })
  })

  test('rejects refunding a cancelled order', async () => {
    const order = await seedOrder('pending')
    await updateOrderStatus(order.id, 'cancelled', db)

    const result = await refundOrderWorkflow(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'INVALID_PAYMENT_STATE' })
  })

  test('returns NO_REFUNDABLE_PAYMENT when no succeeded payment exists', async () => {
    const order = await seedOrder('paid')

    const result = await refundOrderWorkflow(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'NO_REFUNDABLE_PAYMENT' })
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await refundOrderWorkflow('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })
})
