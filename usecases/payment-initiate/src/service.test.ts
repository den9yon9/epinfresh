import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createMockPaymentGateway } from '@epinfresh/payment'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { initiateOrderPayment } from './service'

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

async function seedOrder(status: 'pending' | 'shipped' = 'pending') {
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

describe('initiateOrderPayment (usecase)', () => {
  test('creates a pending payment for a payable order', async () => {
    const order = await seedOrder()
    const result = await initiateOrderPayment(order.id, createMockPaymentGateway(), db)

    expect(result.isOk()).toBe(true)
    const { payment } = result._unsafeUnwrap()
    expect(payment.orderId).toBe(order.id)
    expect(payment.status).toBe('pending')
    expect(payment.amount).toBe('25.00')
  })

  test('rejects unknown order', async () => {
    const result = await initiateOrderPayment(
      '00000000-0000-4000-8000-000000000000',
      createMockPaymentGateway(),
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })

  test('rejects non-pending order', async () => {
    const order = await seedOrder('shipped')
    const result = await initiateOrderPayment(order.id, createMockPaymentGateway(), db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_PENDING')
  })
})
