import { createPublicKey, randomBytes, randomUUID } from 'node:crypto'

import { aesGcmEncrypt, signMessage, verifyMessage } from '@epinfresh/payment'

// 微信支付模拟器核心逻辑: 与真实微信服务端行为对齐的"假平台"。
// 真实微信没有官方沙箱, 本模拟器作为本地开发/CI 的 de-facto 沙箱长期保留。
// 与真实微信的差异仅在于: 接受本地生成的商户签名、使用假平台密钥签发回调。
// 将来支付宝 mock 复用同一模式(apps/pay-mock-server/src/alipay.ts)。

export interface WechatMockContext {
  merchantId: string
  appId: string
  apiV3Key: string
  merchantPrivateKey: string
  platformPrivateKey: string
  platformSerialNo: string
  notifyUrl: string
  // 模拟交易登记(模拟器是单进程常驻的内存态): 供查询对账/关闭模拟使用
  transactions: Map<
    string,
    { transactionId: string; total: number; tradeState: 'SUCCESS' | 'CLOSED' }
  >
  // 模拟退款登记: 供退款提交返回
  refunds: Map<string, { refundId: string; status: 'SUCCESS' }>
}

// 构造回调只依赖除交易登记外的上下文字段; 便于测试直接传字面量
type CallbackContext = Omit<WechatMockContext, 'transactions' | 'refunds'>

// 从商户私钥派生公钥, 用于校验网关出站请求签名(与微信侧持有商户公钥同理)
export function merchantPublicKey(merchantPrivateKey: string): string {
  return createPublicKey(merchantPrivateKey).export({ type: 'spki', format: 'pem' }).toString()
}

export interface VerifyMerchantRequestInput {
  merchantPublicKey: string
  method: string
  path: string
  authorization: string
  body: string
}

// 校验网关出站请求的 WECHATPAY2-SHA256-RSA2048 签名(含 5 分钟时间窗)
export function verifyMerchantRequest(input: VerifyMerchantRequestInput): boolean {
  const auth = input.authorization
  const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1]
  const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1]
  const signature = /signature="([^"]+)"/.exec(auth)?.[1]
  if (!timestamp || !nonce || !signature) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false
  const message = `${input.method}\n${input.path}\n${timestamp}\n${nonce}\n${input.body}\n`
  return verifyMessage(input.merchantPublicKey, message, signature)
}

export interface SimulatedCallback {
  headers: Record<string, string>
  body: string
}

export interface SimulateInput {
  outTradeNo: string
  amount: string
  transactionId?: string
}

// 构造一笔"支付成功"回调(资源按 APIv3 AES-GCM 加密, 整包按假平台私钥签名)
export function buildSimulatedCallback(
  ctx: CallbackContext,
  input: SimulateInput,
): SimulatedCallback {
  const total = Math.round(Number(input.amount) * 100)
  const transactionId =
    input.transactionId ?? `mock-txn-${randomUUID().replace(/-/g, '').slice(0, 20)}`
  const plaintext = JSON.stringify({
    appid: ctx.appId,
    mchid: ctx.merchantId,
    out_trade_no: input.outTradeNo,
    transaction_id: transactionId,
    trade_type: 'NATIVE',
    trade_state: 'SUCCESS',
    trade_state_desc: '支付成功',
    bank_type: 'OTHERS',
    attach: '',
    success_time: new Date().toISOString(),
    payer: { openid: 'mock-openid-1' },
    amount: {
      total,
      payer_total: total,
      currency: 'CNY',
      payer_currency: 'CNY',
    },
  })
  const encrypted = aesGcmEncrypt(ctx.apiV3Key, plaintext, 'transaction')
  const body = JSON.stringify({
    id: `evt-${randomUUID()}`,
    create_time: new Date().toISOString(),
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      associated_data: encrypted.associated_data,
    },
  })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(12).toString('base64')
  const signature = signMessage(ctx.platformPrivateKey, `${timestamp}\n${nonce}\n${body}\n`)
  return {
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': ctx.platformSerialNo,
      'content-type': 'application/json',
    },
    body,
  }
}

// 模拟统一下单: 校验商户签名后返回 prepay_id + code_url
export async function handleNativeOrder(ctx: WechatMockContext, req: Request): Promise<Response> {
  const authorization = req.headers.get('authorization') ?? ''
  const body = await req.text()
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'POST',
    path: '/v3/pay/transactions/native',
    authorization,
    body,
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const prepayId = `mock-prepay-${randomUUID().replace(/-/g, '')}`
  const codeUrl = `weixin://wxpay/bizpayurl?pr=${randomBytes(8).toString('hex')}`
  return Response.json({ prepay_id: prepayId, code_url: codeUrl })
}

// 模拟 H5 下单: 校验商户签名后返回收银台 URL(真实微信返回 h5_url, 前端跳转)
export async function handleH5Order(ctx: WechatMockContext, req: Request): Promise<Response> {
  const authorization = req.headers.get('authorization') ?? ''
  const body = await req.text()
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'POST',
    path: '/v3/pay/transactions/h5',
    authorization,
    body,
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const input = JSON.parse(body) as { out_trade_no?: string }
  const origin = new URL(req.url).origin
  return Response.json({
    h5_url: `${origin}/__h5__/pay?out_trade_no=${input.out_trade_no ?? ''}`,
  })
}

// 模拟 JSAPI 下单: 校验商户签名(含 payer.openid)后返回 prepay_id
export async function handleJsapiOrder(ctx: WechatMockContext, req: Request): Promise<Response> {
  const authorization = req.headers.get('authorization') ?? ''
  const body = await req.text()
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'POST',
    path: '/v3/pay/transactions/jsapi',
    authorization,
    body,
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const prepayId = `mock-prepay-jsapi-${randomUUID().replace(/-/g, '')}`
  return Response.json({ prepay_id: prepayId })
}

// 模拟退款申请: 校验商户签名后登记并返回(与真实微信响应结构一致)。
// mock 按同步成功返回; 真实微信此处通常为 PROCESSING(异步结果走退款通知)。
export async function handleRefund(ctx: WechatMockContext, req: Request): Promise<Response> {
  const authorization = req.headers.get('authorization') ?? ''
  const body = await req.text()
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'POST',
    path: '/v3/refund/domestic/refunds',
    authorization,
    body,
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const input = JSON.parse(body) as {
    out_refund_no?: string
    amount?: { refund?: number; total?: number; currency?: string }
  }
  if (!input.out_refund_no) {
    return Response.json(
      { code: 'PARAM_ERROR', message: 'out_refund_no required' },
      { status: 400 },
    )
  }
  const refundId = `mock-refund-${randomUUID().replace(/-/g, '')}`
  ctx.refunds.set(input.out_refund_no, { refundId, status: 'SUCCESS' })
  return Response.json({
    refund_id: refundId,
    out_refund_no: input.out_refund_no,
    status: 'SUCCESS',
    amount: input.amount ?? { refund: 0, total: 0, currency: 'CNY' },
  })
}

// 模拟平台证书下载: 加密返回假平台公钥(与真实 /v3/certificates 响应结构一致)
export function handleCertificates(ctx: WechatMockContext, req: Request): Response {
  const authorization = req.headers.get('authorization') ?? ''
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'GET',
    path: '/v3/certificates',
    authorization,
    body: '',
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const platformPublicKey = merchantPublicKey(ctx.platformPrivateKey)
  const encrypted = aesGcmEncrypt(ctx.apiV3Key, platformPublicKey, '')
  return Response.json({
    data: [
      {
        serial_no: ctx.platformSerialNo,
        effective_time: '2026-01-01T00:00:00+08:00',
        expire_time: '2036-01-01T00:00:00+08:00',
        encrypt_certificate: {
          algorithm: 'AEAD_AES_256_GCM',
          nonce: encrypted.nonce,
          associated_data: encrypted.associated_data,
          ciphertext: encrypted.ciphertext,
        },
      },
    ],
  })
}

// 模拟支付完成: 登记交易并构造回调投递给 notifyUrl, 返回投递结果(供 curl 等触发)
export async function simulatePayment(
  ctx: WechatMockContext,
  input: SimulateInput,
): Promise<{ status: number; body: string }> {
  const transactionId =
    input.transactionId ?? `mock-txn-${randomUUID().replace(/-/g, '').slice(0, 20)}`
  ctx.transactions.set(input.outTradeNo, {
    transactionId,
    total: Math.round(Number(input.amount) * 100),
    tradeState: 'SUCCESS',
  })
  const callback = buildSimulatedCallback(ctx, { ...input, transactionId })
  try {
    const response = await fetch(ctx.notifyUrl, {
      method: 'POST',
      headers: callback.headers,
      body: callback.body,
    })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { status: 502, body: String(error) }
  }
}

// 模拟查询交易状态: 校验商户签名后按登记返回; 未登记视为 NOTPAY(未支付)。
// 与真实微信结构一致(真实响应含 trade_state / transaction_id / amount)。
export function handleQueryTransaction(
  ctx: WechatMockContext,
  req: Request,
  outTradeNo: string,
): Response {
  const url = new URL(req.url)
  const path = `${url.pathname}${url.search}`
  const authorization = req.headers.get('authorization') ?? ''
  const valid = verifyMerchantRequest({
    merchantPublicKey: merchantPublicKey(ctx.merchantPrivateKey),
    method: 'GET',
    path,
    authorization,
    body: '',
  })
  if (!valid) {
    return Response.json({ code: 'SIGN_ERROR', message: '验签失败(模拟)' }, { status: 401 })
  }
  const record = ctx.transactions.get(outTradeNo)
  if (!record) {
    return Response.json({ out_trade_no: outTradeNo, trade_state: 'NOTPAY' })
  }
  return Response.json({
    out_trade_no: outTradeNo,
    trade_state: record.tradeState,
    transaction_id: record.transactionId,
    amount: { total: record.total, currency: 'CNY' },
  })
}

// 模拟关闭交易(用户超时未支付/渠道关闭): 置为 CLOSED, 对账任务据此取消支付单
export function closeTransaction(
  ctx: WechatMockContext,
  input: { outTradeNo: string },
): { closed: boolean } {
  const record = ctx.transactions.get(input.outTradeNo)
  if (!record) return { closed: false }
  record.tradeState = 'CLOSED'
  return { closed: true }
}
