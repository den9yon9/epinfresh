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
let lastH5Body = ''
function startFakeWechatServer(
  verifyKey: string,
  opts: {
    tradeState?: string
    totalFen?: number
    transactionId?: string
    // 退款查询返回的 refund_status
    refundStatus?: string
    // 平台证书列表(serial → 公钥), 提供后 /v3/certificates 按 APIv3 加密返回
    certificates?: Array<{ serialNo: string; publicKey: string }>
  } = {},
) {
  const server = Bun.serve({
    port: 0,
    routes: {
      '/v3/certificates': {
        GET: async (req) => {
          const path = '/v3/certificates'
          const auth = req.headers.get('authorization') ?? ''
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `GET\n${path}\n${timestamp}\n${nonce}\n\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          const data = (opts.certificates ?? []).map((cert) => {
            const encrypted = aesGcmEncrypt(API_V3_KEY, cert.publicKey, '')
            return {
              serial_no: cert.serialNo,
              effective_time: '2026-01-01T00:00:00+08:00',
              expire_time: '2036-01-01T00:00:00+08:00',
              encrypt_certificate: {
                algorithm: 'AEAD_AES_256_GCM',
                nonce: encrypted.nonce,
                associated_data: encrypted.associated_data,
                ciphertext: encrypted.ciphertext,
              },
            }
          })
          return Response.json({ data })
        },
      },
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
      '/v3/pay/transactions/h5': {
        POST: async (req) => {
          const path = '/v3/pay/transactions/h5'
          const body = await req.text()
          const auth = req.headers.get('authorization') ?? ''
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          lastH5Body = body
          return Response.json({ h5_url: 'https://wxpay.example/h5?out_trade_no=1' })
        },
      },
      '/v3/pay/transactions/jsapi': {
        POST: async (req) => {
          const path = '/v3/pay/transactions/jsapi'
          const body = await req.text()
          const auth = req.headers.get('authorization') ?? ''
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          return Response.json({ prepay_id: 'prepay-jsapi-1' })
        },
      },
      '/v3/refund/domestic/refunds': {
        POST: async (req) => {
          const path = '/v3/refund/domestic/refunds'
          const body = await req.text()
          const auth = req.headers.get('authorization') ?? ''
          const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
          const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
          const signature = /signature="([^"]+)"/.exec(auth)?.[1]
          const message = `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`
          if (!signature || !verifyMessage(verifyKey, message, signature)) {
            return new Response('unauthorized', { status: 401 })
          }
          const parsed = JSON.parse(body) as { out_refund_no?: string }
          return Response.json({
            refund_id: 'mock-refund-1',
            out_refund_no: parsed.out_refund_no,
            status: 'SUCCESS',
          })
        },
      },
      '/v3/refund/domestic/refunds/:outRefundNo': {
        GET: async (req) => {
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
            out_refund_no: url.pathname.split('/').pop(),
            refund_status: opts.refundStatus ?? 'SUCCESS',
            refund_id: 'mock-refund-q-1',
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

  test('verifyWebhook maps a refund notify (REFUND.SUCCESS) with refund fields', async () => {
    const plaintext = JSON.stringify({
      appid: 'wx-app-1',
      mchid: 'mch-100',
      out_trade_no: 'trade-001',
      out_refund_no: 'rf-order-1',
      refund_id: 'wx-refund-1',
      refund_status: 'SUCCESS',
      transaction_id: 'wx-txn-1',
      amount: { refund: 2500, total: 2500, currency: 'CNY' },
    })
    const encrypted = aesGcmEncrypt(API_V3_KEY, plaintext, 'refund')
    const body = JSON.stringify({
      id: 'evt-refund-1',
      create_time: '2026-08-18T10:00:01+08:00',
      event_type: 'REFUND.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        associated_data: encrypted.associated_data,
      },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = 'cb-nonce-refund'
    const signature = signMessage(platform.privateKey, `${timestamp}\n${nonce}\n${body}\n`)
    const result = await gateway.verifyWebhook({
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signature,
        'wechatpay-serial': 'P-SERIAL-1',
      },
      rawBody: body,
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      channel: 'wechat',
      eventId: 'evt-refund-1',
      outTradeNo: 'trade-001',
      providerTransactionId: 'wx-refund-1',
      amount: '25.00',
      status: 'refunded',
      refundNo: 'rf-order-1',
      refundStatus: 'succeeded',
    })
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

describe('wechat gateway refund', () => {
  test('submits refund with signed request and maps SUCCESS to succeeded', async () => {
    const server = startFakeWechatServer(merchant.publicKey)
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refund!({
      outTradeNo: 'trade-001',
      refundNo: 'rf-order-1',
      amount: '10.00',
      total: '25.00',
      currency: 'CNY',
      reason: '用户申请退款',
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({ refundId: 'mock-refund-1', status: 'succeeded' })

    server.stop(true)
  })

  test('returns GATEWAY_ERROR when the merchant signature is rejected', async () => {
    const rogue = generateRsaKeyPair()
    const server = startFakeWechatServer(rogue.publicKey)
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refund!({
      outTradeNo: 'trade-001',
      refundNo: 'rf-order-1',
      amount: '10.00',
      total: '25.00',
      currency: 'CNY',
    })
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error).toBe('GATEWAY_ERROR')

    server.stop(true)
  })
})

describe('wechat gateway refundQuery', () => {
  test('maps refund_status SUCCESS to succeeded with refund id', async () => {
    const server = startFakeWechatServer(merchant.publicKey, { refundStatus: 'SUCCESS' })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refundQuery!({ refundNo: 'rf-order-1', outTradeNo: 'trade-001' })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({ status: 'succeeded', refundId: 'mock-refund-q-1' })

    server.stop(true)
  })

  test('maps ABNORMAL to abnormal', async () => {
    const server = startFakeWechatServer(merchant.publicKey, { refundStatus: 'ABNORMAL' })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refundQuery!({ refundNo: 'rf-order-1', outTradeNo: 'trade-001' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('abnormal')

    server.stop(true)
  })

  test('maps PROCESSING to processing', async () => {
    const server = startFakeWechatServer(merchant.publicKey, { refundStatus: 'PROCESSING' })
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refundQuery!({ refundNo: 'rf-order-1', outTradeNo: 'trade-001' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('processing')

    server.stop(true)
  })

  test('returns GATEWAY_ERROR when the merchant signature is rejected', async () => {
    const rogue = generateRsaKeyPair()
    const server = startFakeWechatServer(rogue.publicKey)
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const result = await gateway.refundQuery!({ refundNo: 'rf-order-1', outTradeNo: 'trade-001' })
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error).toBe('GATEWAY_ERROR')

    server.stop(true)
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

describe('wechat gateway platform certificate rotation', () => {
  // 模拟微信轮换后的新平台证书: 与回调签名使用的私钥匹配
  const rotated = generateRsaKeyPair()

  test('verifyWebhook fetches certificates by serial when the configured key is stale', async () => {
    // 配置里是旧(失效)公钥, 模拟器 /v3/certificates 提供轮换后的新证书
    const server = startFakeWechatServer(merchant.publicKey, {
      certificates: [
        { serialNo: 'P-SERIAL-ROTATED', publicKey: rotated.publicKey },
        { serialNo: 'P-SERIAL-OLD', publicKey: platform.publicKey },
      ],
    })
    const gateway = createWechatPaymentGateway({
      ...baseConfig,
      baseUrl: server.url.origin,
      // 故意放错公钥: 只有走证书拉取+serial 匹配才能验签通过
      platformPublicKey: generateRsaKeyPair().publicKey,
    })

    // 回调用轮换后的新私钥签名, 头带新 serial
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
      signPrivateKey: rotated.privateKey,
    })
    headers['wechatpay-serial'] = 'P-SERIAL-ROTATED'

    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('succeeded')

    server.stop(true)
  })

  test('verifyWebhook matches the legacy serial from the certificate list', async () => {
    const server = startFakeWechatServer(merchant.publicKey, {
      certificates: [
        { serialNo: 'P-SERIAL-ROTATED', publicKey: rotated.publicKey },
        { serialNo: 'P-SERIAL-1', publicKey: platform.publicKey },
      ],
    })
    const gateway = createWechatPaymentGateway({
      ...baseConfig,
      baseUrl: server.url.origin,
      platformPublicKey: generateRsaKeyPair().publicKey,
    })

    // 旧 serial(P-SERIAL-1)回调: 从拉取的证书列表命中旧公钥
    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)

    server.stop(true)
  })

  test('verifyWebhook falls back to the configured key when fetching fails', async () => {
    // 模拟器不提供 /v3/certificates → 拉取失败 → 退回 config.platformPublicKey
    const server = startFakeWechatServer(merchant.publicKey)
    const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

    const { headers, body } = buildCallback({
      outTradeNo: 'trade-001',
      transactionId: 'wx-txn-1',
      totalFen: 2500,
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)

    server.stop(true)
  })
})

describe('wechat gateway H5 and JSAPI ordering', () => {
  const server = startFakeWechatServer(merchant.publicKey)
  const gateway = createWechatPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

  afterAll(() => {
    server.stop(true)
  })

  test('createPayment with product=h5 returns a redirect payload', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'trade-h5-1',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: 'd',
      channelContext: { product: 'h5' },
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.payload).toEqual({
      type: 'redirect',
      url: 'https://wxpay.example/h5?out_trade_no=1',
    })
    // 未传 clientIp 时 H5 下单 scene_info 用默认 127.0.0.1
    expect(JSON.parse(lastH5Body).scene_info.payer_client_ip).toBe('127.0.0.1')
  })

  test('H5 ordering passes the real client ip from channelContext', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'trade-h5-2',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: 'd',
      channelContext: { product: 'h5', clientIp: '203.0.113.7' },
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(JSON.parse(lastH5Body).scene_info.payer_client_ip).toBe('203.0.113.7')
  })

  test('createPayment with openid returns JSAPI pay params signed with RSA', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'trade-jsapi-1',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: 'd',
      channelContext: { openid: 'o-test-jsapi' },
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    const params = result.value.payload
    expect(params.type).toBe('params')
    if (params.type !== 'params') return
    expect(params.params.appId).toBe(baseConfig.appId)
    expect(params.params.signType).toBe('RSA')
    expect(params.params.package).toBe('prepay_id=prepay-jsapi-1')
    // paySign 应能由商户公钥验证 "appId\ntimeStamp\nnonceStr\npackage\n"
    const content = `${params.params.appId}\n${params.params.timeStamp}\n${params.params.nonceStr}\n${params.params.package}\n`
    expect(verifyMessage(merchant.publicKey, content, params.params.paySign)).toBe(true)
  })

  test('createPayment without context stays on Native qr', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'trade-native-1',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: 'd',
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.payload).toEqual({
      type: 'qr',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=TEST',
    })
  })
})
