import { afterAll, describe, expect, test } from 'bun:test'

import { type WechatGatewayConfig } from '../config/wechat'
import { aesGcmEncrypt, generateRsaKeyPair, signMessage, verifyMessage } from '../wechat/crypto'
import { createWechatPaymentGateway } from './wechat'

const merchant = generateRsaKeyPair()
const platform = generateRsaKeyPair()
const API_V3_KEY = '0123456789abcdef0123456789abcdef'

const baseConfig: WechatGatewayConfig = {
  baseUrl: '',
  merchantId: 'mch-100',
  appId: 'wx-app-1',
  apiV3Key: API_V3_KEY,
  merchantSerialNo: 'M-SERIAL-1',
  merchantPrivateKey: merchant.privateKey,
  platformPublicKey: platform.publicKey,
  notifyUrl: 'https://store.example.com/payments/notify/wechat',
}

// 构造一个微信平台回调 {headers, body}: 资源按 APIv3 加密, 整包按平台私钥签名
function buildCallback(input: {
  outTradeNo: string
  transactionId: string
  totalFen: number
  tradeState?: 'SUCCESS' | 'REFUND' | 'CLOSED'
  eventId?: string
  timestamp?: string
  signPrivateKey?: string
}): { headers: Record<string, string>; body: string } {
  const plaintext = JSON.stringify({
    appid: 'wx-app-1',
    mchid: 'mch-100',
    out_trade_no: input.outTradeNo,
    transaction_id: input.transactionId,
    trade_type: 'NATIVE',
    trade_state: input.tradeState ?? 'SUCCESS',
    trade_state_desc: '支付成功',
    bank_type: 'OTHERS',
    attach: '',
    success_time: '2026-08-17T10:00:00+08:00',
    payer: { openid: 'o-test-1' },
    amount: {
      total: input.totalFen,
      payer_total: input.totalFen,
      currency: 'CNY',
      payer_currency: 'CNY',
    },
  })
  const encrypted = aesGcmEncrypt(API_V3_KEY, plaintext, 'transaction')
  const body = JSON.stringify({
    id: input.eventId ?? 'evt-test-1',
    create_time: '2026-08-17T10:00:01+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      associated_data: encrypted.associated_data,
    },
  })
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = 'cb-nonce-1'
  const signature = signMessage(
    input.signPrivateKey ?? platform.privateKey,
    `${timestamp}\n${nonce}\n${body}\n`,
  )
  return {
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': 'P-SERIAL-1',
      'content-type': 'application/json',
    },
    body,
  }
}

// 模拟微信统一下单服务端: 校验商户签名后返回 prepay_id + code_url
function startFakeWechatServer(
  verifyKey: string,
  opts: { tradeState?: string; totalFen?: number; transactionId?: string } = {},
) {
  const server = Bun.serve({
    port: 0,
    routes: {
      '/v3/pay/transactions/native': {
        POST: async (req) => {
          const auth = req.headers.get('authorization') ?? ''
          const method = 'POST'
          const path = '/v3/pay/transactions/native'
          const body = await req.text()
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          return Response.json({
            prepay_id: 'prepay-test-1',
            code_url: 'weixin://wxpay/bizpayurl?pr=TEST',
          })
        },
      },
      '/v3/pay/transactions/out-trade-no/:outTradeNo': {
        GET: async (req) => {
          // 签名 canonical URL 含查询串, 与网关发出的完全一致才放行
          const url = new URL(req.url)
          const path = `${url.pathname}${url.search}`
          const auth = req.headers.get('authorization') ?? ''
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `GET\n${path}\n${timestamp}\n${nonce}\n\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          return Response.json({
            out_trade_no: url.pathname.split('/').pop(),
            trade_state: opts.tradeState ?? 'SUCCESS',
            transaction_id: opts.transactionId ?? 'wx-txn-q-1',
            amount: { total: opts.totalFen ?? 2500, currency: 'CNY' },
          })
        },
      },
    },
  })
  return server
}

describe('wechat gateway', () => {
  const server = startFakeWechatServer(merchant.publicKey)
  const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

  afterAll(async () => {
    server.stop(true)
  })

  test('createPayment signs request accepted by WeChat, returns qr payload', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'trade-001',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: '一品鲜订单 order-1',
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.providerRef).toBe('prepay-test-1')
    expect(result.value.payload).toEqual({
      type: 'qr',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=TEST',
    })
  })

  test('createPayment fails with GATEWAY_ERROR when merchant signature is rejected', async () => {
    const wrongKey = generateRsaKeyPair()
    const bad = createWechatPaymentGateway({
      ...baseConfig,
      baseUrl: server.url.origin,
      merchantPrivateKey: wrongKey.privateKey,
    })
    const result = await bad.createPayment({
      outTradeNo: 'trade-002',
      orderId: 'order-2',
      amount: '10.00',
      currency: 'CNY',
      description: 'd',
    })
    expect(result.isErr()).toBe(true)
  })

  test('verifyWebhook accepts signed + encrypted SUCCESS callback', async () => {
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      channel: 'wechat',
      eventId: 'evt-test-1',
      outTradeNo: 'trade-001',
      providerTransactionId: 'wx-txn-1',
      amount: '25.00',
      status: 'succeeded',
    })
  })

  test('verifyWebhook maps REFUND trade state', async () => {
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
      tradeState: 'REFUND',
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.status).toBe('refunded')
  })

  test('verifyWebhook rejects tampered body', async () => {
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const tampered = body.replace('evt-test-1', 'evt-test-9')
    const result = await gateway.verifyWebhook({ headers, rawBody: tampered })
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error).toBe('SIGNATURE_INVALID')
  })

  test('verifyWebhook rejects replayed callback (expired timestamp)', async () => {
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
      timestamp: String(Math.floor(Date.now() / 1000) - 6 * 60),
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isErr()).toBe(true)
  })

  test('verifyWebhook rejects callback signed by wrong platform key', async () => {
    const rogue = generateRsaKeyPair()
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
      signPrivateKey: rogue.privateKey,
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isErr()).toBe(true)
  })

  test('verifyWebhook rejects missing signature headers', async () => {
    const { body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const result = await gateway.verifyWebhook({ headers: {}, rawBody: body })
    expect(result.isErr()).toBe(true)
  })

  test('verifyWebhook rejects callback encrypted with wrong APIv3 key', async () => {
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const wrongKeyGateway = createWechatPaymentGateway({
      ...baseConfig,
      apiV3Key: 'fedcba9876543210fedcba9876543210',
    })
    const result = await wrongKeyGateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isErr()).toBe(true)
  })
})

describe('wechat gateway queryPayment', () => {
  test('returns paid with amount and transaction id', async () => {
    const server = startFakeWechatServer(merchant.publicKey, {
      tradeState: 'SUCCESS',
      totalFen: 2500,
      transactionId: 'wx-txn-q-1',
    })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.queryPayment!('trade-001')
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      status: 'paid',
      providerTransactionId: 'wx-txn-q-1',
      amount: '25.00',
    })

    server.stop(true)
  })

  test('maps NOTPAY to unpaid', async () => {
    const server = startFakeWechatServer(merchant.publicKey, { tradeState: 'NOTPAY' })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.queryPayment!('trade-001')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('unpaid')

    server.stop(true)
  })

  test('maps CLOSED to closed', async () => {
    const server = startFakeWechatServer(merchant.publicKey, { tradeState: 'CLOSED' })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.queryPayment!('trade-001')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('closed')

    server.stop(true)
  })

  test('returns GATEWAY_ERROR when the merchant signature is rejected', async () => {
    const rogue = generateRsaKeyPair()
    const server = startFakeWechatServer(rogue.publicKey)
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.queryPayment!('trade-001')
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error).toBe('GATEWAY_ERROR')

    server.stop(true)
  })
})
