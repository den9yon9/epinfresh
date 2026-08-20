import {
  type AlipayMockContext,
  closeAlipayTransaction,
  handleAlipayGateway,
  simulateAlipayPayment,
} from './alipay'
import { type PayMockServerConfig } from './config'
import {
  closeTransaction,
  handleCertificates,
  handleH5Order,
  handleJsapiOrder,
  handleNativeOrder,
  handleQueryTransaction,
  handleRefund,
  type SimulateInput,
  simulatePayment,
  type WechatMockContext,
} from './wechat'

export interface PayMockServer {
  readonly url: string
  stop(): void
  // 触发一笔模拟支付成功回调并投递到 notifyUrl
  simulate(input: SimulateInput): Promise<{ status: number; body: string }>
  // 模拟渠道侧关闭交易(对账任务据此取消本地 pending 支付单)
  closeSimulation(input: { outTradeNo: string }): { closed: boolean }
  // 支付宝: 触发模拟支付成功通知
  simulateAlipay(input: SimulateInput): Promise<{ status: number; body: string }>
  // 支付宝: 模拟渠道侧关闭交易
  closeAlipay(input: { outTradeNo: string }): { closed: boolean }
}

export function startPayMockServer(config: PayMockServerConfig): PayMockServer {
  const ctx: WechatMockContext = {
    merchantId: config.merchantId,
    appId: config.appId,
    apiV3Key: config.apiV3Key,
    merchantPrivateKey: config.merchantPrivateKey,
    platformPrivateKey: config.platformPrivateKey,
    platformSerialNo: config.platformSerialNo,
    notifyUrl: config.notifyUrl,
    transactions: new Map(),
    refunds: new Map(),
  }

  // 支付宝复用同一套密钥对(merchant=商户侧, platform=假平台侧), 签名算法 RSA2
  const alipayCtx: AlipayMockContext = {
    appId: config.alipayAppId ?? 'mock-alipay-app',
    merchantPrivateKey: config.merchantPrivateKey,
    platformPrivateKey: config.platformPrivateKey,
    notifyUrl: config.notifyUrl,
    transactions: new Map(),
    refunds: new Map(),
  }

  const server = Bun.serve({
    port: config.port,
    routes: {
      // 微信 APIv3 端点(与真实微信响应结构一致)
      '/v3/pay/transactions/native': {
        POST: (req) => handleNativeOrder(ctx, req),
      },
      '/v3/pay/transactions/h5': {
        POST: (req) => handleH5Order(ctx, req),
      },
      '/v3/pay/transactions/jsapi': {
        POST: (req) => handleJsapiOrder(ctx, req),
      },
      '/v3/refund/domestic/refunds': {
        POST: (req) => handleRefund(ctx, req),
      },
      '/v3/pay/transactions/out-trade-no/:outTradeNo': {
        GET: (req) => handleQueryTransaction(ctx, req, req.params.outTradeNo),
      },
      '/v3/certificates': {
        GET: (req) => handleCertificates(ctx, req),
      },
      // 支付宝网关端点(与真实支付宝 gateway.do 结构一致, method 参数分发)
      '/gateway.do': {
        POST: (req) => handleAlipayGateway(alipayCtx, req),
      },
      // 非微信端点: 开发者用 curl 触发模拟支付完成/关闭
      '/__simulate__/pay': {
        POST: async (req) => {
          const body = (await req.json()) as SimulateInput
          if (!body.outTradeNo || !body.amount) {
            return Response.json(
              { error: 'outTradeNo and amount (yuan string) are required' },
              { status: 400 },
            )
          }
          const result = await simulatePayment(ctx, body)
          return Response.json({ sent: true, status: result.status, responseBody: result.body })
        },
      },
      '/__simulate__/close': {
        POST: async (req) => {
          const body = (await req.json()) as { outTradeNo: string }
          if (!body.outTradeNo) {
            return Response.json({ error: 'outTradeNo is required' }, { status: 400 })
          }
          const result = closeTransaction(ctx, body)
          return Response.json(result)
        },
      },
      // 支付宝模拟端点
      '/__simulate__/alipay/pay': {
        POST: async (req) => {
          const body = (await req.json()) as SimulateInput
          if (!body.outTradeNo || !body.amount) {
            return Response.json(
              { error: 'outTradeNo and amount (yuan string) are required' },
              { status: 400 },
            )
          }
          const result = await simulateAlipayPayment(alipayCtx, body)
          return Response.json({ sent: true, status: result.status, responseBody: result.body })
        },
      },
      '/__simulate__/alipay/close': {
        POST: async (req) => {
          const body = (await req.json()) as { outTradeNo: string }
          if (!body.outTradeNo) {
            return Response.json({ error: 'outTradeNo is required' }, { status: 400 })
          }
          return Response.json(closeAlipayTransaction(alipayCtx, body))
        },
      },
    },
  })

  return {
    url: server.url.origin,
    stop: () => server.stop(true),
    simulate: (input) => simulatePayment(ctx, input),
    closeSimulation: (input) => closeTransaction(ctx, input),
    simulateAlipay: (input) => simulateAlipayPayment(alipayCtx, input),
    closeAlipay: (input) => closeAlipayTransaction(alipayCtx, input),
  }
}
