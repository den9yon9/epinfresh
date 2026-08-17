import { createPublicKey } from 'node:crypto'

import { err, ok, type Result } from '@epinfresh/shared'

import { type WechatGatewayConfig } from '../config/wechat'
import {
  type PaymentGateway,
  type PaymentPayload,
  type VerifyWebhookContext,
  type VerifyWebhookError,
  type WebhookEvent,
} from '../gateway'
import { aesGcmDecrypt, buildAuthorizationHeader, verifyPlatformSignature } from '../wechat/crypto'

const NATIVE_ORDER_PATH = '/v3/pay/transactions/native'

function toFen(amount: string): number {
  const fen = Math.round(Number(amount) * 100)
  if (!Number.isFinite(fen)) throw new Error(`[wechat] invalid amount: ${amount}`)
  return fen
}

// 微信回调头字段(统一按小写匹配)
const TIMESTAMP_HEADER = 'wechatpay-timestamp'
const NONCE_HEADER = 'wechatpay-nonce'
const SIGNATURE_HEADER = 'wechatpay-signature'

// 微信通知体(resource 为加密串)与解密后的资源明文
interface WechatNotification {
  id?: string
  resource?: { ciphertext?: string; nonce?: string; associated_data?: string }
}
interface WechatResource {
  out_trade_no?: string
  transaction_id?: string
  trade_state?: string
  amount?: { total?: number }
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

// 运行时拉取平台公钥(GET /v3/certificates, 出站请求同样走商户签名)。
// 真实微信在证书轮换/首次接入时使用; 联调期可从 pay-mock-server 拉取假平台证书。
export async function fetchWechatPlatformPublicKey(
  config: WechatGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<string, 'GATEWAY_ERROR'>> {
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
      encrypt_certificate?: { ciphertext: string; nonce: string; associated_data: string }
    }>
  }
  const first = payload.data?.[0]?.encrypt_certificate
  if (!first) return err('GATEWAY_ERROR')
  try {
    const pem = aesGcmDecrypt(config.apiV3Key, first)
    return ok(extractPublicKeyFromPem(pem))
  } catch {
    return err('GATEWAY_ERROR')
  }
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
  if (!data.out_trade_no || !data.trade_state) return err('UNSUPPORTED')

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
  const gateway: WechatPaymentGateway = {
    channel: 'wechat',
    notifySuccessBody: 'SUCCESS',
    config,
    async createPayment(input) {
      const path = NATIVE_ORDER_PATH
      const body = JSON.stringify({
        appid: config.appId,
        mchid: config.merchantId,
        description: input.description,
        out_trade_no: input.outTradeNo,
        notify_url: config.notifyUrl,
        amount: { total: toFen(input.amount), currency: input.currency },
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
      const data = (await response.json()) as { prepay_id?: string; code_url?: string }
      if (!data.prepay_id || !data.code_url) return err('GATEWAY_ERROR')
      const payload: PaymentPayload = { type: 'qr', codeUrl: data.code_url }
      return ok({ providerRef: data.prepay_id, payload })
    },
    async verifyWebhook(ctx: VerifyWebhookContext) {
      const timestamp = getHeader(ctx.headers, TIMESTAMP_HEADER)
      const nonce = getHeader(ctx.headers, NONCE_HEADER)
      const signature = getHeader(ctx.headers, SIGNATURE_HEADER)
      if (!timestamp || !nonce || !signature) return err('SIGNATURE_INVALID')

      const verified = verifyPlatformSignature({
        platformPublicKey: config.platformPublicKey,
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
  }
  return gateway
}
