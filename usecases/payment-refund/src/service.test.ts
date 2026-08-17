import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { updateOrderStatus } from '@epinfresh/order'
import { createMockPaymentGateway, initiatePayment, type PaymentGateway } from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { err, ok } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { buildRefundNo, refundOrderWorkflow } from './service'

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
    .payment
  const confirmed = await confirmOrderPayment(payment.id, db)
  if (confirmed.isErr()) throw new Error('seed confirm failed')
  return { order, payment }
}

// 默认网关: mock 退款恒成功(与生产默认一致)
const mockGateways = { mock: createMockPaymentGateway() }

describe('refundOrderWorkflow', () => {
  test('refunds the payment and marks the order refunded atomically', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()

    const result = await refundOrderWorkflow(order.id, mockGateways, db)
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

    const result = await refundOrderWorkflow(order.id, mockGateways, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('rejects refunding a cancelled order', async () => {
    const order = await seedOrder('pending')
    await updateOrderStatus(order.id, 'cancelled', db)

    const result = await refundOrderWorkflow(order.id, mockGateways, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('returns NO_REFUNDABLE_PAYMENT when no succeeded payment exists', async () => {
    const order = await seedOrder('paid')

    const result = await refundOrderWorkflow(order.id, mockGateways, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('NO_REFUNDABLE_PAYMENT')
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await refundOrderWorkflow(
      '00000000-0000-4000-8000-000000000000',
      mockGateways,
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })

  test('does not flip local state when the gateway refund is rejected', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()
    const failingGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return err('GATEWAY_ERROR')
      },
    }

    const result = await refundOrderWorkflow(order.id, { mock: failingGateway }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('GATEWAY_ERROR')

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
  })

  test('returns UNSUPPORTED_CHANNEL when the channel has no refund support', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()
    // 模拟网关: 没有 refund 方法(如渠道能力缺失)
    const noRefundGateway: PaymentGateway = {
      channel: 'mock',
      notifySuccessBody: 'OK',
      async createPayment(input) {
        return ok({ providerRef: 'x', payload: { type: 'qr', codeUrl: input.outTradeNo } })
      },
      async verifyWebhook() {
        return err('UNSUPPORTED')
      },
    }

    const result = await refundOrderWorkflow(order.id, { mock: noRefundGateway }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('UNSUPPORTED_CHANNEL')

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
  })

  test('submits a deterministic refund number for idempotent retries', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()
    let receivedRefundNo: string | undefined
    const recordingGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund(input) {
        receivedRefundNo = input.refundNo
        return ok({ refundId: 'mock-refund-1', status: 'succeeded' })
      },
    }

    await refundOrderWorkflow(order.id, { mock: recordingGateway }, db)

    // 同一支付单重试拿到相同 out_refund_no(渠道幂等, 不产生重复退款)
    expect(receivedRefundNo).toBe(buildRefundNo(payment.id))
    expect(receivedRefundNo).toBe(`rf-${payment.id}`)
  })
})
