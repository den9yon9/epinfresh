import { err, ok } from '@epinfresh/shared'

import { type PaymentGateway, type PaymentPayload } from '../gateway'

// ponytail: mock 同步成功, 无真实回调; 确认由 storefront-api 的 mock-only 端点模拟。
export function createMockPaymentGateway(): PaymentGateway {
  return {
    channel: 'mock',
    notifySuccessBody: 'OK',
    async createPayment(input) {
      const payload: PaymentPayload = { type: 'qr', codeUrl: `mock://pay/${input.outTradeNo}` }
      return ok({ providerRef: `mock-${crypto.randomUUID()}`, payload })
    },
    async verifyWebhook() {
      return err('UNSUPPORTED')
    },
    async refund() {
      // mock 退款即时成功: 本地状态翻转即代表渠道结果(与 e2e/admin 既有行为一致)
      return ok({ refundId: `mock-refund-${crypto.randomUUID()}`, status: 'succeeded' })
    },
  }
}
