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
  }
}
