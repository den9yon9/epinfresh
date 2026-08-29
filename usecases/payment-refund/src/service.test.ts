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

    // 同步渠道退款成功事件与状态翻转同事务落 outbox
    const refundNo = result._unsafeUnwrap().refund.outRefundNo
    const [event] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'refund.succeeded'))
    expect(event).toBeDefined()
    expect(event.payload).toMatchObject({
      refundNo,
      paymentId: payment.id,
      orderId: order.id,
      amount: '25.00',
      currency: 'CNY',
    })
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

  test('sync refund creates a succeeded refund record and flips local state', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()

    const result = await refundOrderWorkflow(order.id, mockGateways, db)
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.refund.status).toBe('succeeded')
    expect(result.value.refund.outRefundNo).toBe(buildRefundNo(payment.id))

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')
  })

  test('async refund (wechat processing) only records a processing refund, state untouched', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()
    const asyncGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return ok({ refundId: 'wx-refund-1', status: 'processing' })
      },
    }

    const result = await refundOrderWorkflow(order.id, { mock: asyncGateway }, db)
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.refund.status).toBe('processing')
    expect(result.value.refund.providerRefundId).toBe('wx-refund-1')

    // 订单/支付单保持原状, 等退款通知驱动
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')

    const refunds = await db.select().from(schema.refunds)
    expect(refunds).toHaveLength(1)
    expect(refunds[0].status).toBe('processing')
  })

  test('rejects a duplicate refund submission once a refund record exists', async () => {
    const { order } = await seedPaidOrderWithPayment()
    const asyncGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return ok({ refundId: 'wx-refund-1', status: 'processing' })
      },
    }

    const first = await refundOrderWorkflow(order.id, { mock: asyncGateway }, db)
    expect(first.isOk()).toBe(true)

    const second = await refundOrderWorkflow(order.id, { mock: asyncGateway }, db)
    expect(second.isErr()).toBe(true)
    expect(second._unsafeUnwrapErr()).toBe('INVALID_PAYMENT_STATE')
  })

  test('auto-retries with a new refund number after an abnormal refund', async () => {
    const { order, payment } = await seedPaidOrderWithPayment()
    const asyncGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund(input) {
        return ok({ refundId: `wx-${input.refundNo}`, status: 'processing' })
      },
    }

    // 第一次提交 → processing
    const first = await refundOrderWorkflow(order.id, { mock: asyncGateway }, db)
    expect(first.isOk()).toBe(true)
    if (first.isErr()) return

    // 退款通知失败 → 标 abnormal
    const [refundRow] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, first.value.refund.id))
    await db
      .update(schema.refunds)
      .set({ status: 'abnormal' })
      .where(eq(schema.refunds.id, refundRow.id))

    // 再次退款: 自动换新号重试
    const retry = await refundOrderWorkflow(order.id, { mock: asyncGateway }, db)
    expect(retry.isOk()).toBe(true)
    if (retry.isErr()) return
    expect(retry.value.refund.outRefundNo).toBe(`rf-${payment.id}-2`)
    expect(retry.value.refund.status).toBe('processing')

    const refunds = await db.select().from(schema.refunds)
    expect(refunds).toHaveLength(2)
    expect(refunds.map((r) => r.outRefundNo).sort()).toEqual([
      `rf-${payment.id}`,
      `rf-${payment.id}-2`,
    ])
  })
})
