import { type Result } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

import { type WechatGatewayConfig } from './config/wechat'
import { createMockPaymentGateway } from './gateways/mock'
import { createWechatPaymentGateway } from './gateways/wechat'

// --- 支付载荷(渠道无关) ---
// 前端按 type 分支渲染: qr=扫码, redirect=跳转, params=渠道内拉起(H5/JSAPI 参数)。
// 存入 payments.payload(jsonb), 支付单列表接口原样回传。
export const PaymentPayloadSchema = Type.Union([
  Type.Object({ type: Type.Literal('qr'), codeUrl: Type.String() }),
  Type.Object({ type: Type.Literal('redirect'), url: Type.String() }),
  Type.Object({
    type: Type.Literal('params'),
    params: Type.Record(Type.String(), Type.String()),
  }),
])
export type PaymentPayload = StaticDecode<typeof PaymentPayloadSchema>

// --- 渠道标识: 注册表键 + 支付单 provider 列 ---
export const PAYMENT_CHANNELS = ['mock', 'wechat', 'alipay'] as const
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number]

export interface CreatePaymentInput {
  outTradeNo: string
  orderId: string
  amount: string
  currency: string
  description: string
  // 渠道上下文不透明透传(如微信 JSAPI 的 openid); 核心不解析, 只转交给网关
  channelContext?: Record<string, unknown>
}

export interface WebhookEvent {
  channel: PaymentChannel
  eventId: string
  outTradeNo: string
  providerTransactionId?: string
  amount: string
  status: 'succeeded' | 'failed' | 'refunded'
}

export interface VerifyWebhookContext {
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}

export type VerifyWebhookError = 'SIGNATURE_INVALID' | 'UNSUPPORTED'

// 退款请求: 金额为元字符串。refundNo 由调用方确定性生成(同支付单重试同号, 渠道幂等)。
export interface RefundInput {
  outTradeNo: string
  refundNo: string
  amount: string
  total: string
  currency: string
  reason?: string
}

// 渠道退款结果: 真实渠道异步(微信先返回 PROCESSING, 结果走退款通知); mock 同步成功。
export interface RefundResult {
  refundId?: string
  status: 'processing' | 'succeeded'
}

export interface PaymentGateway {
  readonly channel: PaymentChannel
  // 回调确认成功后回给渠道平台的应答体(微信 'SUCCESS', 支付宝 'success', mock 'OK')
  readonly notifySuccessBody: string
  createPayment(
    input: CreatePaymentInput,
  ): Promise<Result<{ providerRef: string; payload: PaymentPayload }, 'GATEWAY_ERROR'>>
  verifyWebhook(ctx: VerifyWebhookContext): Promise<Result<WebhookEvent, VerifyWebhookError>>
  // 提交退款(渠道调用先于本地状态翻转, 避免"本地已退、渠道未退"分叉)。
  // 渠道无退款能力(如纯本地 mock 之外的未知渠道)时不实现, 退款用例返回 UNSUPPORTED_CHANNEL。
  refund?(input: RefundInput): Promise<Result<RefundResult, 'GATEWAY_ERROR'>>
  // 对账用: 拉取渠道侧交易状态。渠道无外部真值(如 mock)时不实现, 对账任务会跳过该渠道。
  // amount 为元字符串, 供确认管线做金额校验。
  queryPayment?(outTradeNo: string): Promise<
    Result<
      {
        status: 'paid' | 'unpaid' | 'closed'
        providerTransactionId?: string
        amount?: string
      },
      'GATEWAY_ERROR'
    >
  >
}

export type PaymentGatewayConfig =
  { channel: 'mock' } | { channel: 'wechat'; config: WechatGatewayConfig } | { channel: 'alipay' }

// 渠道注册表: 前端按 channel 发起支付, 路由按 channel 分发回调。
// 核心零渠道逻辑, 微信/支付宝都只是可配置的一项; M1 仅 mock 已实现。
export function createPaymentGateways(
  configs: PaymentGatewayConfig[],
): Record<PaymentChannel, PaymentGateway> {
  const registry: Partial<Record<PaymentChannel, PaymentGateway>> = {}
  for (const config of configs) {
    if (registry[config.channel] !== undefined) {
      throw new Error(`[payment] duplicate gateway config: ${config.channel}`)
    }
    switch (config.channel) {
      case 'mock':
        registry.mock = createMockPaymentGateway()
        break
      case 'wechat':
        registry.wechat = createWechatPaymentGateway(config.config)
        break
      case 'alipay':
        throw new Error(
          `[payment] gateway "alipay" not implemented yet; only "mock" and "wechat" are available`,
        )
    }
  }
  return registry as Record<PaymentChannel, PaymentGateway>
}
