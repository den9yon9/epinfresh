import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import {
  buildRefundNo,
  createMockPaymentGateway,
  initiatePayment,
  insertRefund,
  type PaymentGateway,
} from '@epinfresh/payment'
import { err, ok } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  confirmByWebhookEvent,
  confirmOrderPayment,
  confirmRefundByWebhookEvent,
  reconcilePendingPayments,
  reconcilePendingRefunds,
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

describe('reconcilePendingPayments', () => {
  // 以 wechat provider 落库(provider 列决定对账走哪个网关)
  async function seedWechatPayment(orderId: string) {
    const wechatGateway = { ...createMockPaymentGateway(), channel: 'wechat' as const }
    const payment = (await initiatePayment(orderId, wechatGateway, db))._unsafeUnwrap()
    return payment.payment
  }

  // 对账用假 wechat 网关: 只实现 queryPayment, 其余方法不用于对账路径
  function fakeGateway(
    results: Record<
      string,
      { status: 'paid' | 'unpaid' | 'closed'; providerTransactionId?: string; amount?: string }
    >,
  ): Record<'mock' | 'wechat', PaymentGateway> {
    return {
      mock: createMockPaymentGateway(),
      wechat: {
        channel: 'wechat',
        notifySuccessBody: 'SUCCESS',
        async createPayment() {
          throw new Error('not used in reconciliation')
        },
        async verifyWebhook() {
          throw new Error('not used in reconciliation')
        },
        async queryPayment(outTradeNo) {
          const state = results[outTradeNo]
          if (!state) return err('GATEWAY_ERROR')
          return ok(state)
        },
      },
    }
  }

  test('fixes a missed callback: local pending + gateway paid → confirmed + outbox', async () => {
    const order = await seedPendingOrder('25.00')
    const payment = await seedWechatPayment(order.id)
    // 模拟时间流逝: 直接改 createdAt 使支付单进入"超时未确认"窗口
    await db
      .update(schema.payments)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.payments.id, payment.id))
    const gateways = fakeGateway({
      [payment.outTradeNo]: {
        status: 'paid',
        providerTransactionId: 'txn-123',
        amount: '25.00',
      },
    })

    const result = await reconcilePendingPayments(gateways, db)
    expect(result.scanned).toBe(1)
    expect(result.fixedPaid).toBe(1)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(afterPayment.providerTransactionId).toBe('txn-123')
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('paid')
    const events = await db.select().from(schema.outboxEvents)
    expect(events).toHaveLength(1)
  })

  test('rejects fixing a paid gateway state when the amount differs', async () => {
    const order = await seedPendingOrder('25.00')
    const payment = await seedWechatPayment(order.id)
    await db
      .update(schema.payments)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.payments.id, payment.id))
    const gateways = fakeGateway({
      [payment.outTradeNo]: { status: 'paid', amount: '1.00' },
    })

    const result = await reconcilePendingPayments(gateways, db)
    expect(result.scanned).toBe(1)
    expect(result.fixedPaid).toBe(0)
    expect(result.skipped).toBe(1)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })

  test('cancels a pending payment when the gateway reports the order closed', async () => {
    const order = await seedPendingOrder()
    const payment = await seedWechatPayment(order.id)
    await db
      .update(schema.payments)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.payments.id, payment.id))
    const gateways = fakeGateway({
      [payment.outTradeNo]: { status: 'closed' },
    })

    const result = await reconcilePendingPayments(gateways, db)
    expect(result.closed).toBe(1)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('cancelled')
    // 订单保持 pending, 用户可重新发起支付
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.status).toBe('pending')
  })

  test('skips payments that are still within the stale window', async () => {
    const order = await seedPendingOrder()
    const payment = await seedWechatPayment(order.id)
    const gateways = fakeGateway({
      [payment.outTradeNo]: { status: 'paid' },
    })

    const result = await reconcilePendingPayments(gateways, db)
    expect(result.scanned).toBe(0)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })

  test('skips mock-provider payments without a queryPayment gateway', async () => {
    const order = await seedPendingOrder()
    const payment = await seedPayment(order.id)
    await db
      .update(schema.payments)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.payments.id, payment.id))

    const result = await reconcilePendingPayments({ mock: createMockPaymentGateway() }, db)
    expect(result.scanned).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('leaves unpaid gateway state untouched', async () => {
    const order = await seedPendingOrder()
    const payment = await seedWechatPayment(order.id)
    await db
      .update(schema.payments)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.payments.id, payment.id))
    const gateways = fakeGateway({ [payment.outTradeNo]: { status: 'unpaid' } })

    const result = await reconcilePendingPayments(gateways, db)
    expect(result.scanned).toBe(1)
    expect(result.fixedPaid).toBe(0)
    expect(result.closed).toBe(0)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })
})

describe('confirmRefundByWebhookEvent', () => {
  async function seedPaidOrderWithRefundRow(status = 'processing') {
    const order = await seedPendingOrder('25.00')
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    const confirmed = await confirmOrderPayment(payment.id, db)
    if (confirmed.isErr()) throw new Error('seed confirm failed')
    const refund = await insertRefund(
      {
        paymentId: payment.id,
        orderId: order.id,
        outRefundNo: buildRefundNo(payment.id),
        amount: payment.amount,
        currency: payment.currency,
        status: status as 'processing' | 'succeeded',
      },
      db,
    )
    return { order, payment, refund }
  }

  function refundEvent(refundNo: string, refundStatus: 'succeeded' | 'abnormal') {
    return {
      channel: 'wechat' as const,
      eventId: crypto.randomUUID(),
      outTradeNo: 'trade-1',
      providerTransactionId: 'wx-refund-1',
      amount: '25.00',
      status: 'refunded' as const,
      refundNo,
      refundStatus,
    }
  }

  test('success notify flips refund, payment and order', async () => {
    const { order, payment, refund } = await seedPaidOrderWithRefundRow()

    const result = await confirmRefundByWebhookEvent(
      refundEvent(refund.outRefundNo, 'succeeded'),
      db,
    )
    expect(result.isOk()).toBe(true)

    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('succeeded')
    expect(afterRefund.providerRefundId).toBe('wx-refund-1')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')

    // 退款成功事件与状态翻转同事务落 outbox
    const [event] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'refund.succeeded'))
    expect(event).toBeDefined()
    expect(event.aggregateId).toBe(refund.id)
    expect(event.payload).toMatchObject({
      refundNo: refund.outRefundNo,
      paymentId: payment.id,
      orderId: order.id,
      amount: '25.00',
      currency: 'CNY',
    })
  })

  test('is idempotent on duplicate refund notifies', async () => {
    const { refund } = await seedPaidOrderWithRefundRow()
    const event = refundEvent(refund.outRefundNo, 'succeeded')

    await confirmRefundByWebhookEvent(event, db)
    const again = await confirmRefundByWebhookEvent(event, db)
    expect(again.isOk()).toBe(true)
  })

  test('abnormal notify marks the refund abnormal without flipping state', async () => {
    const { order, payment, refund } = await seedPaidOrderWithRefundRow()

    const result = await confirmRefundByWebhookEvent(
      refundEvent(refund.outRefundNo, 'abnormal'),
      db,
    )
    expect(result.isOk()).toBe(true)

    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('abnormal')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
  })

  test('rejects a refund notify whose amount differs from the refund record', async () => {
    const { order, payment, refund } = await seedPaidOrderWithRefundRow()
    const event = { ...refundEvent(refund.outRefundNo, 'succeeded'), amount: '1.00' }

    const result = await confirmRefundByWebhookEvent(event, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('AMOUNT_MISMATCH')

    // 状态不动: 退款单/支付单/订单均保持原状
    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('processing')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
  })

  test('unknown refund no is acknowledged without changes', async () => {
    const result = await confirmRefundByWebhookEvent(refundEvent('rf-unknown', 'succeeded'), db)
    expect(result.isOk()).toBe(true)
    expect(await db.select().from(schema.refunds)).toHaveLength(0)
  })

  test('dispatch: confirmByWebhookEvent routes refund notifies to the refund state machine', async () => {
    const { order, payment, refund } = await seedPaidOrderWithRefundRow()

    const result = await confirmByWebhookEvent(refundEvent(refund.outRefundNo, 'succeeded'), db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')
  })
})

describe('reconcilePendingRefunds', () => {
  // 以 wechat provider 落库, 退款单 processing, 并让 created_at 过期进入对账窗口
  async function seedProcessingRefund() {
    const order = await seedPendingOrder('25.00')
    const wechatGateway = { ...createMockPaymentGateway(), channel: 'wechat' as const }
    const payment = (await initiatePayment(order.id, wechatGateway, db))._unsafeUnwrap().payment
    const confirmed = await confirmOrderPayment(payment.id, db)
    if (confirmed.isErr()) throw new Error('seed confirm failed')
    const refund = await insertRefund(
      {
        paymentId: payment.id,
        orderId: order.id,
        outRefundNo: buildRefundNo(payment.id),
        amount: payment.amount,
        currency: payment.currency,
      },
      db,
    )
    await db
      .update(schema.refunds)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.refunds.id, refund.id))
    return { order, payment, refund }
  }

  function fakeRefundGateway(
    results: Record<string, { status: 'processing' | 'succeeded' | 'abnormal'; refundId?: string }>,
  ): Record<'mock' | 'wechat', PaymentGateway> {
    return {
      mock: createMockPaymentGateway(),
      wechat: {
        channel: 'wechat',
        notifySuccessBody: 'SUCCESS',
        async createPayment() {
          throw new Error('not used')
        },
        async verifyWebhook() {
          throw new Error('not used')
        },
        async refundQuery(input) {
          const state = results[input.refundNo]
          if (!state) return err('GATEWAY_ERROR')
          return ok(state)
        },
      },
    }
  }

  test('fixes a lost refund notify: gateway succeeded → flips refund, payment and order', async () => {
    const { order, payment, refund } = await seedProcessingRefund()
    const gateways = fakeRefundGateway({
      [refund.outRefundNo]: { status: 'succeeded', refundId: 'wx-refund-q' },
    })

    const result = await reconcilePendingRefunds(gateways, db)
    expect(result.scanned).toBe(1)
    expect(result.fixedSucceeded).toBe(1)

    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('succeeded')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')
  })

  test('marks the refund abnormal when the gateway reports ABNORMAL', async () => {
    const { order, payment, refund } = await seedProcessingRefund()
    const gateways = fakeRefundGateway({
      [refund.outRefundNo]: { status: 'abnormal' },
    })

    const result = await reconcilePendingRefunds(gateways, db)
    expect(result.fixedAbnormal).toBe(1)

    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('abnormal')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
  })

  test('leaves processing state untouched when the gateway is still processing', async () => {
    const { order, refund } = await seedProcessingRefund()
    const gateways = fakeRefundGateway({
      [refund.outRefundNo]: { status: 'processing' },
    })

    const result = await reconcilePendingRefunds(gateways, db)
    expect(result.scanned).toBe(1)
    expect(result.fixedSucceeded).toBe(0)
    expect(result.fixedAbnormal).toBe(0)

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
  })

  test('skips refunds without a refundQuery gateway (mock)', async () => {
    const { refund } = await seedProcessingRefund()

    const result = await reconcilePendingRefunds({ mock: createMockPaymentGateway() }, db)
    expect(result.scanned).toBe(0)
    expect(result.skipped).toBe(1)

    const [afterRefund] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id))
    expect(afterRefund.status).toBe('processing')
  })
})
