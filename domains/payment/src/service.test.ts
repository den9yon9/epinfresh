import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createMockPaymentGateway } from './gateways/mock'
import {
  confirmPayment,
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

// 域函数收快照(编排层经 order 域 getPayableOrder 取得并校验 pending 后传入);
// 订单存在性/可支付状态的拒绝路径在 usecases/payment-initiate 测试。
async function pay(order: typeof schema.orders.$inferSelect) {
  return initiatePayment(
    { id: order.id, totalAmount: order.totalAmount, currency: order.currency },
    createMockPaymentGateway(),
    db,
  )
}

describe('payment domain', () => {
  test('initiates a pending payment with provider ref', async () => {
    const order = await seedOrder()
    const result = await pay(order)

    expect(result.isOk()).toBe(true)
    const payment = result._unsafeUnwrap().payment
    expect(payment.orderId).toBe(order.id)
    expect(payment.status).toBe('pending')
    expect(payment.amount).toBe('25.00')
    expect(payment.provider).toBe('mock')
    expect(payment.providerRef).toMatch(/^mock-/)
  })

  test('confirming payment marks the payment succeeded', async () => {
    const order = await seedOrder()
    const payment = (await pay(order))._unsafeUnwrap().payment

    const result = await confirmPayment(payment.id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().payment.status).toBe('succeeded')
  })

  test('confirming twice is rejected', async () => {
    const order = await seedOrder()
    const payment = (await pay(order))._unsafeUnwrap().payment
    await confirmPayment(payment.id, db)

    const again = await confirmPayment(payment.id, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('refunds a succeeded payment', async () => {
    const order = await seedOrder()
    const payment = (await pay(order))._unsafeUnwrap().payment
    await confirmPayment(payment.id, db)

    const refunded = await refundPayment(payment.id, db)
    expect(refunded.isOk()).toBe(true)
    expect(refunded._unsafeUnwrap().status).toBe('refunded')
  })

  test('cannot refund a pending payment', async () => {
    const order = await seedOrder()
    const payment = (await pay(order))._unsafeUnwrap().payment

    const refunded = await refundPayment(payment.id, db)
    expect(refunded.isErr()).toBe(true)
    expect(refunded._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('lists payments by order', async () => {
    const order = await seedOrder()
    await pay(order)

    const { items } = await listPaymentsByOrder(order.id, db)
    expect(items).toHaveLength(1)
  })

  test('refundOrder refunds the succeeded payment', async () => {
    const order = await seedOrder()
    const payment = (await pay(order))._unsafeUnwrap().payment
    await confirmPayment(payment.id, db)

    const result = await refundOrder(order.id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('refunded')
  })

  test('refundOrder returns NO_REFUNDABLE_PAYMENT without a succeeded payment', async () => {
    const order = await seedOrder()
    await db.update(schema.orders).set({ status: 'paid' }).where(eq(schema.orders.id, order.id))
    await pay(order)

    const result = await refundOrder(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('NO_REFUNDABLE_PAYMENT')
  })
})
