import { afterAll, describe, expect, test } from 'bun:test'

import { buildAlipaySignContent, rsa2Sign, rsa2Verify } from '../alipay/crypto'
import { type AlipayGatewayConfig } from '../config/alipay'
import { generateRsaKeyPair } from '../wechat/crypto'
import { createAlipayPaymentGateway } from './alipay'

const merchant = generateRsaKeyPair()
const platform = generateRsaKeyPair()

const baseConfig: AlipayGatewayConfig = {
  baseUrl: '',
  appId: 'mock-alipay-app',
  appPrivateKey: merchant.privateKey,
  alipayPublicKey: platform.publicKey,
  notifyUrl: 'https://store.example.com/payments/notify/alipay',
}

// 构造支付宝异步通知: 表单 URL 编码, 平台私钥 RSA2 签名
function buildNotify(input: {
  outTradeNo: string
  tradeStatus?: string
  totalAmount?: string
  tradeNo?: string
  notifyId?: string
  signPrivateKey?: string
}): { headers: Record<string, string>; body: string } {
  const params = {
    app_id: 'mock-alipay-app',
    notify_id: input.notifyId ?? 'notify-1',
    notify_time: '2026-08-18 10:00:00',
    notify_type: 'trade_status_sync',
    trade_status: input.tradeStatus ?? 'TRADE_SUCCESS',
    out_trade_no: input.outTradeNo,
    trade_no: input.tradeNo ?? 'mock-trade-1',
    total_amount: input.totalAmount ?? '25.00',
    charset: 'utf-8',
    sign_type: 'RSA2',
  }
  const signature = rsa2Sign(
    buildAlipaySignContent(params),
    input.signPrivateKey ?? platform.privateKey,
  )
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, sign: signature }).toString(),
  }
}

// 模拟支付宝网关: 校验商户 RSA2 签名后按 method 分发
function startFakeAlipayServer(
  verifyKey: string,
  transactions: Map<string, { tradeNo: string; totalAmount: string; tradeStatus: string }>,
) {
  const server = Bun.serve({
    port: 0,
    routes: {
      '/gateway.do': {
        POST: async (req) => {
          const body = await req.text()
          const params = Object.fromEntries(new URLSearchParams(body))
          const content = buildAlipaySignContent(params)
          if (!params.sign || !rsa2Verify(content, params.sign, verifyKey)) {
            return Response.json({ code: '40002', msg: '签名错误' }, { status: 401 })
          }
          const method = params.method
          const biz = JSON.parse(params.biz_content ?? '{}') as Record<string, string>
          if (method === 'alipay.trade.precreate') {
            transactions.set(biz.out_trade_no, {
              tradeNo: 'mock-trade-1',
              totalAmount: biz.total_amount,
              tradeStatus: 'WAIT_BUYER_PAY',
            })
            return Response.json({
              alipay_trade_precreate_response: {
                code: '10000',
                msg: 'Success',
                out_trade_no: biz.out_trade_no,
                qr_code: `alipay://qr?out_trade_no=${biz.out_trade_no}`,
              },
            })
          }
          if (method === 'alipay.trade.query') {
            const tx = transactions.get(biz.out_trade_no)
            return Response.json({
              alipay_trade_query_response: {
                code: '10000',
                msg: 'Success',
                out_trade_no: biz.out_trade_no,
                trade_no: tx?.tradeNo,
                trade_status: tx?.tradeStatus ?? 'WAIT_BUYER_PAY',
                total_amount: tx?.totalAmount,
              },
            })
          }
          if (method === 'alipay.trade.refund') {
            return Response.json({
              alipay_trade_refund_response: {
                code: '10000',
                msg: 'Success',
                out_trade_no: biz.out_trade_no,
                refund_fee: biz.refund_amount,
              },
            })
          }
          return Response.json({ code: '40004', msg: 'unknown method' }, { status: 400 })
        },
      },
    },
  })
  return server
}

describe('alipay gateway', () => {
  const transactions = new Map<
    string,
    { tradeNo: string; totalAmount: string; tradeStatus: string }
  >()
  const server = startFakeAlipayServer(merchant.publicKey, transactions)
  const gateway = createAlipayPaymentGateway({ ...baseConfig, baseUrl: server.url.origin })

  afterAll(() => {
    server.stop(true)
  })

  test('createPayment signs the precreate request and returns qr payload', async () => {
    const result = await gateway.createPayment({
      outTradeNo: 'alipay-trade-1',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      description: '一品鲜订单 order-1',
    })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.payload).toEqual({
      type: 'qr',
      codeUrl: 'alipay://qr?out_trade_no=alipay-trade-1',
    })
    expect(transactions.get('alipay-trade-1')?.totalAmount).toBe('25.00')
  })

  test('createPayment fails with GATEWAY_ERROR when the request is signed by the wrong key', async () => {
    const rogue = generateRsaKeyPair()
    const bad = createAlipayPaymentGateway({
      ...baseConfig,
      baseUrl: server.url.origin,
      appPrivateKey: rogue.privateKey,
    })
    const result = await bad.createPayment({
      outTradeNo: 'alipay-trade-2',
      orderId: 'order-2',
      amount: '10.00',
      currency: 'CNY',
      description: 'd',
    })
    expect(result.isErr()).toBe(true)
  })

  test('verifyWebhook accepts a signed TRADE_SUCCESS notify', async () => {
    const { headers, body } = buildNotify({ outTradeNo: 'alipay-trade-1' })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      channel: 'alipay',
      eventId: 'notify-1',
      outTradeNo: 'alipay-trade-1',
      providerTransactionId: 'mock-trade-1',
      amount: '25.00',
      status: 'succeeded',
    })
  })

  test('verifyWebhook maps TRADE_FINISHED to succeeded', async () => {
    const { body } = buildNotify({ outTradeNo: 'alipay-trade-1', tradeStatus: 'TRADE_FINISHED' })
    const result = await gateway.verifyWebhook({ headers: {}, rawBody: body })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('succeeded')
  })

  test('verifyWebhook rejects a tampered notify', async () => {
    const { headers, body } = buildNotify({ outTradeNo: 'alipay-trade-1' })
    const tampered = body.replace('total_amount=25.00', 'total_amount=1.00')
    const result = await gateway.verifyWebhook({ headers, rawBody: tampered })
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error).toBe('SIGNATURE_INVALID')
  })

  test('verifyWebhook rejects a notify signed by the wrong key', async () => {
    const rogue = generateRsaKeyPair()
    const { headers, body } = buildNotify({
      outTradeNo: 'alipay-trade-1',
      signPrivateKey: rogue.privateKey,
    })
    const result = await gateway.verifyWebhook({ headers, rawBody: body })
    expect(result.isErr()).toBe(true)
  })

  test('queryPayment reports paid with amount and transaction id', async () => {
    transactions.get('alipay-trade-1')!.tradeStatus = 'TRADE_SUCCESS'
    const result = await gateway.queryPayment!('alipay-trade-1')
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      status: 'paid',
      providerTransactionId: 'mock-trade-1',
      amount: '25.00',
    })
  })

  test('queryPayment maps unknown trade to unpaid', async () => {
    const result = await gateway.queryPayment!('unknown-trade')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('unpaid')
  })

  test('refund returns succeeded synchronously', async () => {
    const result = await gateway.refund!({
      outTradeNo: 'alipay-trade-1',
      refundNo: 'rf-order-1',
      amount: '25.00',
      total: '25.00',
      currency: 'CNY',
      reason: '用户申请退款',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.status).toBe('succeeded')
  })
})
