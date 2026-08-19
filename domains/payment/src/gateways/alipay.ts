import { err, ok, type Result } from '@epinfresh/shared'

import { alipayTimestamp, buildAlipaySignContent, rsa2Sign, rsa2Verify } from '../alipay/crypto'
import { type AlipayGatewayConfig } from '../config/alipay'
import {
  type PaymentGateway,
  type PaymentPayload,
  type RefundInput,
  type VerifyWebhookContext,
  type WebhookEvent,
} from '../gateway'

const GATEWAY_PATH = '/gateway.do'
const SUCCESS_CODE = '10000'

function responseKey(method: string): string {
  return `${method.replaceAll('.', '_')}_response`
}

// 构造并提交签名请求(method 在参数内, 响应键由 method 推导)。
async function callGateway(
  config: AlipayGatewayConfig,
  rawParams: Record<string, string>,
): Promise<Result<Record<string, unknown>, 'GATEWAY_ERROR'>> {
  const signed = {
    ...rawParams,
    sign: rsa2Sign(buildAlipaySignContent(rawParams), config.appPrivateKey),
  }
  const body = new URLSearchParams(signed).toString()
  const response = await fetch(`${config.baseUrl}${GATEWAY_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  if (!response.ok) return err('GATEWAY_ERROR')
  const data = (await response.json()) as Record<string, Record<string, unknown>>
  const result = data[responseKey(rawParams.method)]
  if (!result || result.code !== SUCCESS_CODE) return err('GATEWAY_ERROR')
  return ok(result)
}

function baseParams(config: AlipayGatewayConfig, method: string): Record<string, string> {
  return {
    app_id: config.appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
  }
}

export function createAlipayPaymentGateway(config: AlipayGatewayConfig): PaymentGateway {
  return {
    channel: 'alipay',
    // 支付宝要求回调确认应答为纯文本 "success"
    notifySuccessBody: 'success',
    async createPayment(input) {
      const result = await callGateway(config, {
        ...baseParams(config, 'alipay.trade.precreate'),
        notify_url: config.notifyUrl,
        biz_content: JSON.stringify({
          out_trade_no: input.outTradeNo,
          total_amount: input.amount,
          subject: input.description,
        }),
      })
      if (result.isErr()) return err('GATEWAY_ERROR')
      const qrCode = String(result.value.qr_code ?? '')
      if (!qrCode) return err('GATEWAY_ERROR')
      const payload: PaymentPayload = { type: 'qr', codeUrl: qrCode }
      return ok({ providerRef: qrCode, payload })
    },
    async verifyWebhook(ctx: VerifyWebhookContext) {
      // 异步通知为表单 URL 编码, 验签用解码后的参数
      const params = Object.fromEntries(new URLSearchParams(ctx.rawBody))
      const sign = params.sign
      if (!sign || params.sign_type !== 'RSA2') return err('SIGNATURE_INVALID')
      const content = buildAlipaySignContent(params)
      if (!rsa2Verify(content, sign, config.alipayPublicKey)) return err('SIGNATURE_INVALID')
      const outTradeNo = params.out_trade_no
      if (!outTradeNo) return err('SIGNATURE_INVALID')

      // TRADE_SUCCESS/TRADE_FINISHED → succeeded; 其余(TRADE_CLOSED/WAIT_BUYER_PAY)确认消费不落状态
      const status: WebhookEvent['status'] =
        params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED'
          ? 'succeeded'
          : 'failed'
      return ok({
        channel: 'alipay',
        eventId: params.notify_id ?? `${outTradeNo}:${params.trade_no ?? ''}`,
        outTradeNo,
        providerTransactionId: params.trade_no,
        amount: params.total_amount,
        status,
      })
    },
    async queryPayment(outTradeNo) {
      const result = await callGateway(config, {
        ...baseParams(config, 'alipay.trade.query'),
        biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
      })
      if (result.isErr()) return err('GATEWAY_ERROR')
      const tradeStatus = String(result.value.trade_status ?? '')
      const status =
        tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
          ? 'paid'
          : tradeStatus === 'WAIT_BUYER_PAY'
            ? 'unpaid'
            : 'closed'
      return ok({
        status,
        providerTransactionId: result.value.trade_no ? String(result.value.trade_no) : undefined,
        amount: result.value.total_amount ? String(result.value.total_amount) : undefined,
      })
    },
    async refund(input: RefundInput) {
      // 支付宝退款为同步接口: code 10000 即退款成功
      const result = await callGateway(config, {
        ...baseParams(config, 'alipay.trade.refund'),
        biz_content: JSON.stringify({
          out_trade_no: input.outTradeNo,
          refund_amount: input.amount,
        }),
      })
      if (result.isErr()) return err('GATEWAY_ERROR')
      return ok({ status: 'succeeded' })
    },
    async refundQuery(input) {
      // 退款查询: alipay.trade.refund.query, out_request_no 为退款单号
      const result = await callGateway(config, {
        ...baseParams(config, 'alipay.trade.refund.query'),
        biz_content: JSON.stringify({
          out_trade_no: input.outTradeNo,
          out_request_no: input.refundNo,
        }),
      })
      if (result.isErr()) return err('GATEWAY_ERROR')
      const refundStatus = String(result.value.refund_status ?? '')
      const status =
        refundStatus === 'REFUND_SUCCESS' || refundStatus === 'REFUND_CLOSED'
          ? 'succeeded'
          : refundStatus === 'REFUND_FAIL'
            ? 'abnormal'
            : 'processing'
      return ok({
        status,
        refundId: result.value.refund_id ? String(result.value.refund_id) : undefined,
      })
    },
  }
}
