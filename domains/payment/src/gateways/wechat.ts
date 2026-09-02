import { createPublicKey, randomBytes } from 'node:crypto'

import { err, InvariantViolation, ok, type Result } from '@epinfresh/shared'

import { type WechatGatewayConfig } from '../config/wechat'
import {
  type PaymentGateway,
  type PaymentPayload,
  type VerifyWebhookContext,
  type VerifyWebhookError,
  type WebhookEvent,
} from '../gateway'
import {
  aesGcmDecrypt,
  buildAuthorizationHeader,
  signMessage,
  verifyPlatformSignature,
} from '../wechat/crypto'

const NATIVE_ORDER_PATH = '/v3/pay/transactions/native'
const H5_ORDER_PATH = '/v3/pay/transactions/h5'
const JSAPI_ORDER_PATH = '/v3/pay/transactions/jsapi'
const REFUND_PATH = '/v3/refund/domestic/refunds'

function toFen(amount: string): number {
  const fen = Math.round(Number(amount) * 100)
  if (!Number.isFinite(fen)) throw new InvariantViolation(`[wechat] invalid amount: ${amount}`)
  return fen
}

// 按 out_trade_no 查询交易状态; canonical URL 含查询串, 出站签名须逐字一致
function buildQueryPath(outTradeNo: string, merchantId: string): string {
  return `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${merchantId}`
}

// JSAPI 拉起参数(payload.type='params'): 前端在微信内调 wx.chooseWXPay。
// paySign = RSA-SHA256 over "appId\ntimeStamp\nnonceStr\npackage\n", 商户私钥签, base64。
function buildJsapiPayload(config: WechatGatewayConfig, prepayId: string): PaymentPayload {
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = randomBytes(16).toString('hex')
  const packageValue = `prepay_id=${prepayId}`
  const paySign = signMessage(
    config.merchantPrivateKey,
    `${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`,
  )
  return {
    type: 'params',
    params: {
      appId: config.appId,
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA',
      paySign,
    },
  }
}

// 微信回调头字段(统一按小写匹配)
const TIMESTAMP_HEADER = 'wechatpay-timestamp'
const NONCE_HEADER = 'wechatpay-nonce'
const SIGNATURE_HEADER = 'wechatpay-signature'
const SERIAL_HEADER = 'wechatpay-serial'

// 微信通知体(resource 为加密串)与解密后的资源明文
interface WechatNotification {
  id?: string
  resource?: { ciphertext?: string; nonce?: string; associated_data?: string }
}
interface WechatResource {
  out_trade_no?: string
  transaction_id?: string
  trade_state?: string
  // 退款通知专用字段(REFUND.SUCCESS / REFUND.ABNORMAL)
  out_refund_no?: string
  refund_status?: string
  refund_id?: string
  amount?: { total?: number; refund?: number }
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

export interface WechatPaymentGateway extends PaymentGateway {
  readonly channel: 'wechat'
  readonly config: WechatGatewayConfig
}

// 将 /v3/certificates 返回的平台证书(经 APIv3 解密后的 PEM)解析为公钥 PEM
export function extractPublicKeyFromPem(pem: string): string {
  return createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString()
}

export interface WechatPlatformCertificate {
  serialNo: string
  // SPKI 公钥 PEM
  publicKey: string
}

// 拉取全部平台证书(GET /v3/certificates, 出站请求同样走商户签名)。
// 微信会轮换平台证书, 验签须按回调头 wechatpay-serial 定位对应公钥, 不能只存单张。
export async function fetchWechatPlatformCertificates(
  config: WechatGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<WechatPlatformCertificate[], 'GATEWAY_ERROR'>> {
  const path = '/v3/certificates'
  const authorization = buildAuthorizationHeader({
    merchantId: config.merchantId,
    merchantSerialNo: config.merchantSerialNo,
    merchantPrivateKey: config.merchantPrivateKey,
    method: 'GET',
    canonicalUrl: path,
    body: '',
  })
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    headers: { Authorization: authorization, Accept: 'application/json' },
  })
  if (!response.ok) return err('GATEWAY_ERROR')
  const payload = (await response.json()) as {
    data?: Array<{
      serial_no?: string
      encrypt_certificate?: { ciphertext: string; nonce: string; associated_data: string }
    }>
  }
  const certificates: WechatPlatformCertificate[] = []
  for (const item of payload.data ?? []) {
    const encrypted = item.encrypt_certificate
    if (!item.serial_no || !encrypted?.ciphertext) continue
    try {
      const pem = aesGcmDecrypt(config.apiV3Key, encrypted)
      certificates.push({ serialNo: item.serial_no, publicKey: extractPublicKeyFromPem(pem) })
    } catch {
      // 单张证书解析失败跳过, 不影响其余证书
    }
  }
  return certificates.length > 0 ? ok(certificates) : err('GATEWAY_ERROR')
}

// 兼容入口: 取第一张平台证书的公钥(联调/首次初始化用)
export async function fetchWechatPlatformPublicKey(
  config: WechatGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<string, 'GATEWAY_ERROR'>> {
  const result = await fetchWechatPlatformCertificates(config, fetchImpl)
  if (result.isErr()) return err('GATEWAY_ERROR')
  return ok(result.value[0].publicKey)
}

// 将回调通知映射为渠道无关事件; 仅支持支付结果通知(含 SUCCESS/REFUND/其他终态)
function mapWebhookEvent(
  apiV3Key: string,
  payload: WechatNotification,
): Result<WebhookEvent, VerifyWebhookError> {
  const resource = payload.resource
  if (!resource?.ciphertext || !resource.nonce) return err('SIGNATURE_INVALID')

  let rawResource: string
  try {
    rawResource = aesGcmDecrypt(apiV3Key, {
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      associated_data: resource.associated_data ?? '',
    })
  } catch {
    return err('SIGNATURE_INVALID')
  }
  const data = JSON.parse(rawResource) as WechatResource
  if (!data.out_trade_no) return err('UNSUPPORTED')

  // 退款通知(REFUND.SUCCESS / REFUND.ABNORMAL): resource 无 trade_state, 有 refund_status/out_refund_no
  if (data.refund_status) {
    return ok({
      channel: 'wechat',
      eventId: (payload.id as string) ?? `${data.out_trade_no}:${data.out_refund_no ?? ''}`,
      outTradeNo: data.out_trade_no,
      providerTransactionId: data.refund_id,
      amount: ((data.amount?.refund ?? data.amount?.total ?? 0) / 100).toFixed(2),
      status: 'refunded',
      refundNo: data.out_refund_no,
      refundStatus: data.refund_status === 'SUCCESS' ? 'succeeded' : 'abnormal',
    })
  }

  if (!data.trade_state) return err('UNSUPPORTED')

  const status: WebhookEvent['status'] =
    data.trade_state === 'SUCCESS'
      ? 'succeeded'
      : data.trade_state === 'REFUND'
        ? 'refunded'
        : 'failed'

  return ok({
    channel: 'wechat',
    eventId: (payload.id as string) ?? `${data.out_trade_no}:${data.transaction_id ?? ''}`,
    outTradeNo: data.out_trade_no,
    providerTransactionId: data.transaction_id,
    amount: ((data.amount?.total ?? 0) / 100).toFixed(2),
    status,
  })
}

export function createWechatPaymentGateway(config: WechatGatewayConfig): WechatPaymentGateway {
  // 平台证书缓存: serial_no → 公钥 PEM(微信会轮换证书, 验签按回调头 serial 定位)
  const certificates = new Map<string, string>()
  let lastFetchAttempt = 0
  let inFlightFetch: Promise<void> | null = null
  // 拉取失败/未命中时至少间隔 1 分钟再尝试, 避免回调风暴下反复拉取
  const MIN_CERT_REFRESH_MS = 60_000

  // 并发安全: 共享在途请求, 创建时预拉与回调触发共用同一 Promise;
  // lastFetchAttempt 在请求真正结束后才更新, 避免预拉进行中把回调触发的拉取挡掉
  async function ensureCertificates(): Promise<void> {
    if (Date.now() - lastFetchAttempt < MIN_CERT_REFRESH_MS) return
    if (inFlightFetch) return inFlightFetch
    inFlightFetch = (async () => {
      try {
        const result = await fetchWechatPlatformCertificates(config)
        if (result.isOk()) {
          for (const cert of result.value) certificates.set(cert.serialNo, cert.publicKey)
        }
      } catch {
        // 拉取失败(网络/配置缺失)不阻断回调处理: 退回 config.platformPublicKey
      } finally {
        lastFetchAttempt = Date.now()
        inFlightFetch = null
      }
    })()
    return inFlightFetch
  }

  // 创建时后台预拉一次, 消除证书轮换后首笔回调的拉取延迟; 失败静默(触发式刷新兜底)
  void ensureCertificates()

  // 按回调头 wechatpay-serial 选公钥; 缓存未命中先拉取一次, 仍无则退回 config 配置
  async function resolvePlatformKey(serial: string | undefined): Promise<string> {
    if (serial) {
      const cached = certificates.get(serial)
      if (cached) return cached
    }
    await ensureCertificates()
    if (serial) {
      const refreshed = certificates.get(serial)
      if (refreshed) return refreshed
    }
    return config.platformPublicKey
  }

  const gateway: WechatPaymentGateway = {
    channel: 'wechat',
    notifySuccessBody: 'SUCCESS',
    config,
    async createPayment(input) {
      // 渠道上下文由网关消费(核心不解析): product=h5 走 H5 下单, openid 存在走 JSAPI 下单,
      // 否则 Native 扫码。三种产品返回不同 payload 类型, 前端按 type 渲染。
      const isH5 = input.channelContext?.product === 'h5'
      const openid =
        typeof input.channelContext?.openid === 'string' ? input.channelContext.openid : undefined

      const path = isH5 ? H5_ORDER_PATH : openid ? JSAPI_ORDER_PATH : NATIVE_ORDER_PATH
      const body = JSON.stringify({
        appid: config.appId,
        mchid: config.merchantId,
        description: input.description,
        out_trade_no: input.outTradeNo,
        notify_url: config.notifyUrl,
        amount: { total: toFen(input.amount), currency: input.currency },
        ...(openid ? { payer: { openid } } : {}),
        ...(isH5
          ? {
              scene_info: {
                payer_client_ip:
                  typeof input.channelContext?.clientIp === 'string'
                    ? input.channelContext.clientIp
                    : '127.0.0.1',
                h5_info: { type: 'Wap' },
              },
            }
          : {}),
      })
      const authorization = buildAuthorizationHeader({
        merchantId: config.merchantId,
        merchantSerialNo: config.merchantSerialNo,
        merchantPrivateKey: config.merchantPrivateKey,
        method: 'POST',
        canonicalUrl: path,
        body,
      })
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      })
      if (!response.ok) return err('GATEWAY_ERROR')
      const data = (await response.json()) as {
        prepay_id?: string
        code_url?: string
        h5_url?: string
      }

      if (isH5) {
        // H5: 返回收银台 URL, 前端跳转
        if (!data.h5_url) return err('GATEWAY_ERROR')
        const payload: PaymentPayload = { type: 'redirect', url: data.h5_url }
        return ok({ providerRef: data.h5_url, payload })
      }

      if (openid) {
        // JSAPI: 返回拉起参数, 前端在微信内 wx.chooseWXPay
        if (!data.prepay_id) return err('GATEWAY_ERROR')
        return ok({
          providerRef: data.prepay_id,
          payload: buildJsapiPayload(config, data.prepay_id),
        })
      }

      if (!data.prepay_id || !data.code_url) return err('GATEWAY_ERROR')
      const payload: PaymentPayload = { type: 'qr', codeUrl: data.code_url }
      return ok({ providerRef: data.prepay_id, payload })
    },
    async verifyWebhook(ctx: VerifyWebhookContext) {
      const timestamp = getHeader(ctx.headers, TIMESTAMP_HEADER)
      const nonce = getHeader(ctx.headers, NONCE_HEADER)
      const signature = getHeader(ctx.headers, SIGNATURE_HEADER)
      if (!timestamp || !nonce || !signature) return err('SIGNATURE_INVALID')

      const serial = getHeader(ctx.headers, SERIAL_HEADER)
      const platformPublicKey = await resolvePlatformKey(serial)
      const verified = verifyPlatformSignature({
        platformPublicKey,
        timestamp,
        nonce,
        body: ctx.rawBody,
        signature,
      })
      if (!verified) return err('SIGNATURE_INVALID')

      let payload: WechatNotification
      try {
        payload = JSON.parse(ctx.rawBody) as WechatNotification
      } catch {
        return err('SIGNATURE_INVALID')
      }
      return mapWebhookEvent(config.apiV3Key, payload)
    },
    async queryPayment(outTradeNo) {
      const path = buildQueryPath(outTradeNo, config.merchantId)
      const authorization = buildAuthorizationHeader({
        merchantId: config.merchantId,
        merchantSerialNo: config.merchantSerialNo,
        merchantPrivateKey: config.merchantPrivateKey,
        method: 'GET',
        canonicalUrl: path,
        body: '',
      })
      const response = await fetch(`${config.baseUrl}${path}`, {
        headers: { Authorization: authorization, Accept: 'application/json' },
      })
      if (!response.ok) return err('GATEWAY_ERROR')
      const data = (await response.json()) as {
        trade_state?: string
        transaction_id?: string
        amount?: { total?: number }
      }
      // SUCCESS→paid; NOTPAY/USERPAYING→unpaid; CLOSED/REVOKED/PAYERROR/REFUND→closed
      const tradeState = data.trade_state
      const status =
        tradeState === 'SUCCESS'
          ? 'paid'
          : tradeState === 'NOTPAY' || tradeState === 'USERPAYING'
            ? 'unpaid'
            : 'closed'
      return ok({
        status,
        providerTransactionId: data.transaction_id,
        amount: data.amount?.total !== undefined ? (data.amount.total / 100).toFixed(2) : undefined,
      })
    },
    async refund(input) {
      const body = JSON.stringify({
        out_trade_no: input.outTradeNo,
        out_refund_no: input.refundNo,
        reason: input.reason,
        amount: {
          refund: toFen(input.amount),
          total: toFen(input.total),
          currency: input.currency,
        },
      })
      const authorization = buildAuthorizationHeader({
        merchantId: config.merchantId,
        merchantSerialNo: config.merchantSerialNo,
        merchantPrivateKey: config.merchantPrivateKey,
        method: 'POST',
        canonicalUrl: REFUND_PATH,
        body,
      })
      const response = await fetch(`${config.baseUrl}${REFUND_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      })
      if (!response.ok) return err('GATEWAY_ERROR')
      const data = (await response.json()) as { refund_id?: string; status?: string }
      // 真实微信退款异步: 提交后为 PROCESSING, 结果走退款通知回调; mock 直接 SUCCESS
      const status = data.status === 'SUCCESS' ? 'succeeded' : 'processing'
      return ok({ refundId: data.refund_id, status })
    },
    async refundQuery(input) {
      // 退款查询: GET /v3/refund/domestic/refunds/{out_refund_no}
      const path = `${REFUND_PATH}/${encodeURIComponent(input.refundNo)}`
      const authorization = buildAuthorizationHeader({
        merchantId: config.merchantId,
        merchantSerialNo: config.merchantSerialNo,
        merchantPrivateKey: config.merchantPrivateKey,
        method: 'GET',
        canonicalUrl: path,
        body: '',
      })
      const response = await fetch(`${config.baseUrl}${path}`, {
        headers: { Authorization: authorization, Accept: 'application/json' },
      })
      if (!response.ok) return err('GATEWAY_ERROR')
      const data = (await response.json()) as {
        refund_status?: string
        refund_id?: string
      }
      const status =
        data.refund_status === 'SUCCESS'
          ? 'succeeded'
          : data.refund_status === 'ABNORMAL'
            ? 'abnormal'
            : 'processing'
      return ok({ status, refundId: data.refund_id })
    },
  }
  return gateway
}
