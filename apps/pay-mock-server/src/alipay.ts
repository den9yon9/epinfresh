import { createPublicKey, randomUUID } from 'node:crypto'

import { buildAlipaySignContent, rsa2Sign, rsa2Verify } from '@epinfresh/payment'

// 支付宝支付模拟器核心逻辑: 与真实支付宝行为对齐的"假平台"。
// 与真实支付宝的差异仅在于: 接受本地生成的商户签名、使用假平台私钥签响应/回调。
// 复用 wechat mock 的密钥对(merchant=商户侧, platform=假平台侧), 只是签名算法换成 RSA2。

export interface AlipayMockContext {
  appId: string
  // 商户私钥: 派生公钥校验商户出站请求签名
  merchantPrivateKey: string
  // 假平台私钥: 签响应与异步通知
  platformPrivateKey: string
  notifyUrl: string
  // 内存交易登记: 供查询/模拟支付/关闭
  transactions: Map<string, { tradeNo: string; totalAmount: string; tradeStatus: string }>
  refunds: Map<string, { refundNo: string; refundAmount: string; status: string }>
}

// 从商户私钥派生公钥(与支付宝侧持有应用公钥同理)
export function merchantAlipayPublicKey(merchantPrivateKey: string): string {
  return createPublicKey(merchantPrivateKey).export({ type: 'spki', format: 'pem' }).toString()
}

// 校验商户出站请求: 表单参数中的 sign 是否与商户公钥匹配(RSA2)
export function verifyMerchantAlipayRequest(
  params: Record<string, string>,
  merchantPublicKey: string,
): boolean {
  const sign = params.sign
  if (!sign) return false
  return rsa2Verify(buildAlipaySignContent(params), sign, merchantPublicKey)
}

// 假平台对响应/通知参数加签(sign 与 sign_type 不参与签名内容)
export function signAlipayParams(
  params: Record<string, string>,
  platformPrivateKey: string,
): Record<string, string> {
  return { ...params, sign: rsa2Sign(buildAlipaySignContent(params), platformPrivateKey) }
}

export function handleAlipayGateway(ctx: AlipayMockContext, req: Request): Promise<Response> {
  return req.text().then((body) => {
    const params = Object.fromEntries(new URLSearchParams(body))
    if (!verifyMerchantAlipayRequest(params, merchantAlipayPublicKey(ctx.merchantPrivateKey))) {
      return Response.json({ code: '40002', msg: '签名校验失败(模拟)' }, { status: 401 })
    }
    const method = params.method
    const bizContent = JSON.parse(params.biz_content ?? '{}') as Record<string, string>
    switch (method) {
      case 'alipay.trade.precreate': {
        const tradeNo = `mock-alipay-trade-${randomUUID().replace(/-/g, '').slice(0, 16)}`
        ctx.transactions.set(bizContent.out_trade_no, {
          tradeNo,
          totalAmount: bizContent.total_amount,
          tradeStatus: 'WAIT_BUYER_PAY',
        })
        const inner = {
          code: '10000',
          msg: 'Success',
          out_trade_no: bizContent.out_trade_no,
          qr_code: `alipay://qr?out_trade_no=${bizContent.out_trade_no}`,
        }
        const signed = signAlipayParams(inner, ctx.platformPrivateKey)
        return Response.json({ alipay_trade_precreate_response: inner, sign: signed.sign })
      }
      case 'alipay.trade.query': {
        const tx = ctx.transactions.get(bizContent.out_trade_no)
        const raw = {
          code: '10000',
          msg: 'Success',
          out_trade_no: bizContent.out_trade_no,
          trade_no: tx?.tradeNo,
          trade_status: tx?.tradeStatus ?? 'WAIT_BUYER_PAY',
          total_amount: tx?.totalAmount,
        }
        // 剔除未登记交易的缺省字段(真实支付宝未知交易直接报错)
        const inner: Record<string, string> = {}
        for (const [key, value] of Object.entries(raw)) {
          if (value !== undefined) inner[key] = value
        }
        const signed = signAlipayParams(inner, ctx.platformPrivateKey)
        return Response.json({ alipay_trade_query_response: inner, sign: signed.sign })
      }
      case 'alipay.trade.refund': {
        ctx.refunds.set(bizContent.out_trade_no, {
          refundNo: `mock-alipay-refund-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          refundAmount: bizContent.refund_amount,
          status: 'SUCCESS',
        })
        const inner = {
          code: '10000',
          msg: 'Success',
          out_trade_no: bizContent.out_trade_no,
          refund_fee: bizContent.refund_amount,
        }
        const signed = signAlipayParams(inner, ctx.platformPrivateKey)
        return Response.json({ alipay_trade_refund_response: inner, sign: signed.sign })
      }
      default:
        return Response.json({ code: '40004', msg: `unknown method: ${method}` }, { status: 400 })
    }
  })
}

export interface SimulateInput {
  outTradeNo: string
  amount: string
}

// 构造并投递"支付成功"异步通知(表单 URL 编码, 假平台私钥签)
export async function simulateAlipayPayment(
  ctx: AlipayMockContext,
  input: SimulateInput,
): Promise<{ status: number; body: string }> {
  const existing = ctx.transactions.get(input.outTradeNo)
  const tradeNo =
    existing?.tradeNo ?? `mock-alipay-trade-${randomUUID().replace(/-/g, '').slice(0, 16)}`
  ctx.transactions.set(input.outTradeNo, {
    tradeNo,
    totalAmount: input.amount,
    tradeStatus: 'TRADE_SUCCESS',
  })
  const params = signAlipayParams(
    {
      app_id: ctx.appId,
      notify_id: `notify-${randomUUID()}`,
      notify_time: new Date().toISOString(),
      notify_type: 'trade_status_sync',
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: input.outTradeNo,
      trade_no: tradeNo,
      total_amount: input.amount,
      charset: 'utf-8',
      sign_type: 'RSA2',
    },
    ctx.platformPrivateKey,
  )
  try {
    const response = await fetch(ctx.notifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { status: 502, body: String(error) }
  }
}

// 模拟关闭交易(超时未支付)
export function closeAlipayTransaction(
  ctx: AlipayMockContext,
  input: { outTradeNo: string },
): { closed: boolean } {
  const tx = ctx.transactions.get(input.outTradeNo)
  if (!tx) return { closed: false }
  tx.tradeStatus = 'TRADE_CLOSED'
  return { closed: true }
}
