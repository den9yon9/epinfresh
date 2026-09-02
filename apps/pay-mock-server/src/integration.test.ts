import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import {
  createWechatPaymentGateway,
  fetchWechatPlatformPublicKey,
  generateRsaKeyPair,
  signMessage,
  verifyMessage,
} from '@epinfresh/payment'
import { confirmByWebhookEvent } from '@epinfresh/payment-confirm'
import { initiateOrderPayment } from '@epinfresh/payment-initiate'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { type PayMockServerConfig } from './config'
import { startPayMockServer } from './server'

const API_V3_KEY = '0123456789abcdef0123456789abcdef'

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

// 组装: 网关 + 模拟器 + 回调消费端。回调端复刻 storefront-api notify 路由:
// verifyWebhook → confirmByWebhookEvent → 渠道应答体。
function createHarness() {
  const merchant = generateRsaKeyPair()
  const platform = generateRsaKeyPair()
  let hits = 0

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
    apiV3Key: API_V3_KEY,
    merchantPrivateKey: merchant.privateKey,
    platformPrivateKey: platform.privateKey,
    platformSerialNo: 'P-SERIAL-MOCK',
    notifyUrl: `${notifyServer.url.origin}/payments/notify/wechat`,
  }
  const mock = startPayMockServer(mockConfig)

  const gateway = createWechatPaymentGateway({
    baseUrl: mock.url,
    merchantId: mockConfig.merchantId,
    appId: mockConfig.appId,
    apiV3Key: API_V3_KEY,
    merchantSerialNo: 'M-SERIAL-1',
    merchantPrivateKey: merchant.privateKey,
    platformPublicKey: platform.publicKey,
    notifyUrl: mockConfig.notifyUrl,
  })

  return {
    mock,
    gateway,
    merchant,
    platform,
    notifyUrl: mockConfig.notifyUrl,
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

describe('pay-mock-server wechat pipeline', () => {
  test('full round-trip: gateway order → mock accepts → simulated callback → order paid + outbox', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder()

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db)
    expect(initiated.isOk()).toBe(true)
    if (initiated.isErr()) return
    const payment = initiated.value.payment
    expect(payment.provider).toBe('wechat')
    expect(payment.payload).toEqual({
      type: 'qr',
      codeUrl: expect.stringContaining('weixin://wxpay/bizpayurl'),
    })

    const sim = await harness.mock.simulate({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })
    expect(sim.status).toBe(200)
    expect(sim.body).toBe('SUCCESS')
    expect(harness.confirmHits()).toBe(1)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(afterPayment.providerTransactionId).toMatch(/^mock-txn-/)

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')

    const outbox = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, payment.id))
    expect(outbox).toHaveLength(1)
    expect(outbox[0].eventType).toBe('payment.succeeded')
  })

  test('amount mismatch in callback is rejected and order stays pending', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment

    const sim = await harness.mock.simulate({
      outTradeNo: payment.outTradeNo,
      amount: '1.00',
    })
    expect(sim.status).toBe(400)
    expect(sim.body).toBe('FAIL')
    expect(harness.confirmHits()).toBe(0)

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('pending')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('pending')
  })

  test('gateway createPayment is rejected when signed with wrong merchant key', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder()

    const rogueGateway = createWechatPaymentGateway({
      ...{
        baseUrl: harness.mock.url,
        merchantId: 'mock-merchant-1',
        appId: 'mock-app-1',
        apiV3Key: API_V3_KEY,
        merchantSerialNo: 'M-SERIAL-1',
        merchantPrivateKey: harness.merchant.privateKey,
        platformPublicKey: harness.platform.publicKey,
        notifyUrl: harness.notifyUrl,
      },
      merchantPrivateKey: generateRsaKeyPair().privateKey,
    })
    const result = await initiateOrderPayment(order.id, rogueGateway, db)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toBe('GATEWAY_ERROR')
  })

  test('platform public key can be fetched from mock /v3/certificates', async () => {
    const harness = createHarness()
    const config = {
      baseUrl: harness.mock.url,
      merchantId: 'mock-merchant-1',
      appId: 'mock-app-1',
      apiV3Key: API_V3_KEY,
      merchantSerialNo: 'M-SERIAL-1',
      merchantPrivateKey: harness.merchant.privateKey,
      platformPublicKey: harness.platform.publicKey,
      notifyUrl: harness.notifyUrl,
    }
    const fetched = await fetchWechatPlatformPublicKey(config)
    expect(fetched.isOk()).toBe(true)
    if (fetched.isErr()) return
    // 拉取的公钥能验证由假平台私钥签名的消息
    const sig = signMessage(harness.platform.privateKey, 'hello')
    expect(verifyMessage(fetched.value, 'hello', sig)).toBe(true)
  })

  test('queryPayment after simulate reports paid with amount and transaction id', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment

    // 尚未模拟支付: 渠道侧视为 NOTPAY
    const before = await harness.gateway.queryPayment!(payment.outTradeNo)
    expect(before.isOk()).toBe(true)
    if (before.isErr()) return
    expect(before.value.status).toBe('unpaid')

    await harness.mock.simulate({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })

    const after = await harness.gateway.queryPayment!(payment.outTradeNo)
    expect(after.isOk()).toBe(true)
    if (after.isErr()) return
    expect(after.value.status).toBe('paid')
    expect(after.value.amount).toBe('25.00')
    expect(after.value.providerTransactionId).toMatch(/^mock-txn-/)
  })

  test('closeSimulation makes queryPayment report closed (reconciliation cancels it)', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment

    // 模拟渠道关闭(超时未支付)后, 对账查询返回 closed
    await harness.mock.simulate({
      outTradeNo: payment.outTradeNo,
      amount: payment.amount,
    })
    expect(harness.mock.closeSimulation({ outTradeNo: payment.outTradeNo }).closed).toBe(true)

    const queried = await harness.gateway.queryPayment!(payment.outTradeNo)
    expect(queried.isOk()).toBe(true)
    if (queried.isErr()) return
    expect(queried.value.status).toBe('closed')
  })

  test('refund round-trip: gateway refund → mock accepts → SUCCESS', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db)
    if (initiated.isErr()) return
    const payment = initiated.value.payment
    await harness.mock.simulate({
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
    expect(refunded.value.refundId).toMatch(/^mock-refund-/)
  })
})

describe('pay-mock-server wechat H5 and JSAPI ordering', () => {
  test('H5 order returns a redirect payload pointing at the mock cashier', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db, {
      product: 'h5',
    })
    expect(initiated.isOk()).toBe(true)
    if (initiated.isErr()) return
    const { payment, payload } = initiated.value
    expect(payment.provider).toBe('wechat')
    expect(payload.type).toBe('redirect')
    if (payload.type === 'redirect') {
      expect(payload.url).toContain('/__h5__/pay?out_trade_no=')
    }
  })

  test('JSAPI order with openid returns pay params', async () => {
    const harness = createHarness()
    const order = await seedPendingOrder('25.00')

    const initiated = await initiateOrderPayment(order.id, harness.gateway, db, {
      openid: 'o-test-openid',
    })
    expect(initiated.isOk()).toBe(true)
    if (initiated.isErr()) return
    const { payload } = initiated.value
    expect(payload.type).toBe('params')
    if (payload.type === 'params') {
      expect(payload.params.package).toContain('prepay_id=mock-prepay-jsapi-')
      expect(payload.params.signType).toBe('RSA')
    }
  })
})
