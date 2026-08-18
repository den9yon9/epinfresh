import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createAlipayPaymentGateway, generateRsaKeyPair, initiatePayment } from '@epinfresh/payment'
import { confirmByWebhookEvent } from '@epinfresh/payment-confirm'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { type PayMockServerConfig } from './config'
import { startPayMockServer } from './server'

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

function createHarness() {
  const merchant = generateRsaKeyPair()
  const platform = generateRsaKeyPair()
  let hits = 0

  // 回调消费端: 复刻 storefront-api notify 路由(验签 → 确认 → 渠道应答体)
  const notifyServer = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = await req.text()
      const headers: Record<string, string> = {}
      for (const [k, v] of req.headers.entries()) headers[k] = v
      const verified = await gateway.verifyWebhook({ headers, rawBody: body })
      if (verified.isErr()) return new Response('FAIL', { status: 400 })
      const result = await confirmByWebhookEvent(verified.value, db)
      if (result.isErr()) return new Response('FAIL', { status: 400 })
      hits += 1
      return new Response(gateway.notifySuccessBody)
    },
  })

  const mockConfig: PayMockServerConfig = {
    port: 0,
    merchantId: 'mock-merchant-1',
    appId: 'mock-app-1',
    apiV3Key: '0123456789abcdef0123456789abcdef',
    merchantPrivateKey: merchant.privateKey,
    platformPrivateKey: platform.privateKey,
    platformSerialNo: 'P-SERIAL-MOCK',
    notifyUrl: `${notifyServer.url.origin}/payments/notify/alipay`,
    alipayAppId: 'mock-alipay-app',
  }
  const mock = startPayMockServer(mockConfig)

  const gateway = createAlipayPaymentGateway({
    baseUrl: mock.url,
    appId: 'mock-alipay-app',
    appPrivateKey: merchant.privateKey,
    alipayPublicKey: platform.publicKey,
    notifyUrl: mockConfig.notifyUrl,
  })

  return {
    mock,
    gateway,
    merchant,
    platform,
    confirmHits: () => hits,
  }
}

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

describe('pay-mock-server alipay pipeline', () => {
  test('full round-trip: gateway order → mock accepts → simulated notify → order paid + outbox', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiatePayment(order.id, harness.gateway, db)
    expect(initiated.isOk()).toBe(true)
    if (initiated.isErr()) return
    const payment = initiated.value.payment
    expect(payment.provider).toBe('alipay')
    expect(payment.payload).toEqual({
      type: 'qr',
      codeUrl: expect.stringContaining('alipay://qr'),
    })

    const sim = await harness.mock.simulateAlipay({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })
    expect(sim.status).toBe(200)
    expect(sim.body).toBe('success')
    expect(harness.confirmHits()).toBe(1)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(afterPayment.providerTransactionId).toMatch(/^mock-alipay-trade-/)

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')

    const outbox = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, payment.id))
    expect(outbox).toHaveLength(1)
    expect(outbox[0].eventType).toBe('payment.succeeded')
  })

  test('amount mismatch in notify is rejected and order stays pending', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiatePayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment

    const sim = await harness.mock.simulateAlipay({
      outTradeNo: payment.outTradeNo,
      amount: '1.00',
    })
    expect(sim.status).toBe(400)
    expect(sim.body).toBe('FAIL')
    expect(harness.confirmHits()).toBe(0)

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('pending')
  })

  test('queryPayment reflects simulate and close', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder()

    const initiated = await initiatePayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment

    const before = await harness.gateway.queryPayment!(payment.outTradeNo)
    expect(before.isOk()).toBe(true)
    if (before.isErr()) return
    expect(before.value.status).toBe('unpaid')

    await harness.mock.simulateAlipay({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })
    const paid = await harness.gateway.queryPayment!(payment.outTradeNo)
    if (paid.isErr()) return
    expect(paid.value.status).toBe('paid')
    expect(paid.value.amount).toBe('25.00')

    expect(harness.mock.closeAlipay({ outTradeNo: payment.outTradeNo }).closed).toBe(true)
    const closed = await harness.gateway.queryPayment!(payment.outTradeNo)
    if (closed.isErr()) return
    expect(closed.value.status).toBe('closed')
  })

  test('refund round-trip: gateway refund → mock accepts synchronously', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiatePayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment
    await harness.mock.simulateAlipay({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })

    const refunded = await harness.gateway.refund!({
      outTradeNo: payment.outTradeNo,
      refundNo: `rf-${payment.id}`,
      amount: payment.amount,
      total: payment.amount,
      currency: payment.currency,
      reason: 'test refund',
    })
    expect(refunded.isOk()).toBe(true)
    if (refunded.isErr()) return
    expect(refunded.value.status).toBe('succeeded')
  })
})
