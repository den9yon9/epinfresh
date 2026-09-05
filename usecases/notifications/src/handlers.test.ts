import { createLogger } from '@epinfresh/shared'
import { describe, expect, test } from 'bun:test'

import { createTransactionalEmailHandlers } from './handlers'
import { EMAIL_JOB_NAMES } from './jobs'

const logger = createLogger('silent')

function createFakeSender() {
  const sent: { template: string; to: string; vars: Record<string, unknown> }[] = []
  const sender = {
    async send(template: string, to: string, vars: Record<string, unknown>) {
      sent.push({ template, to, vars })
    },
  }
  return { sender, sent }
}

describe('createTransactionalEmailHandlers', () => {
  test('payment-succeeded handler forwards order vars untouched', async () => {
    const { sender, sent } = createFakeSender()
    const handlers = createTransactionalEmailHandlers(sender)
    const payload = {
      name: '小明',
      orderId: 'o1',
      amount: '25.00',
      currency: 'CNY',
      provider: 'mock',
      paidAt: '2026-09-05T00:00:00Z',
    }

    await handlers[EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED]({ to: 'a@b.com', payload }, logger)

    expect(sent[0]).toMatchObject({ template: 'payment-succeeded', to: 'a@b.com', vars: payload })
  })

  test('refund-succeeded and order-shipped handlers forward payload untouched', async () => {
    const { sender, sent } = createFakeSender()
    const handlers = createTransactionalEmailHandlers(sender)

    await handlers[EMAIL_JOB_NAMES.REFUND_SUCCEEDED](
      { to: 'a@b.com', payload: { refundNo: 'rf-1' } },
      logger,
    )
    await handlers[EMAIL_JOB_NAMES.ORDER_SHIPPED](
      { to: 'a@b.com', payload: { orderId: 'o1', trackingNumber: 'SF1' } },
      logger,
    )

    expect(sent).toHaveLength(2)
    expect(sent[0].template).toBe('refund-succeeded')
    expect(sent[1].template).toBe('order-shipped')
  })
})
