import { createLogger } from '@epinfresh/shared'
import { describe, expect, test } from 'bun:test'

import type { WorkerEnv } from './env'
import { createMailer } from './mailer'
import { renderEmail } from './templates'

const logger = createLogger('silent')

function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgres://localhost/test',
    MAIL_TRANSPORT: 'console',
    STOREFRONT_WEB_URL: 'http://localhost:5173',
    ...overrides,
  } as WorkerEnv
}

describe('renderEmail', () => {
  test('renders welcome email with name', () => {
    const email = renderEmail('welcome', { name: '小明' })
    expect(email.subject).toContain('欢迎')
    expect(email.html).toContain('小明')
    expect(email.text).toContain('小明')
  })

  test('renders reset-password email with resetLink in subject/body', () => {
    const link = 'http://localhost:5173/reset-password?token=abc'
    const email = renderEmail('reset-password', { resetLink: link })
    expect(email.html).toContain(link)
    expect(email.text).toContain(link)
  })

  test('throws when reset-password lacks resetLink', () => {
    expect(() => renderEmail('reset-password', {})).toThrow(/resetLink/)
  })

  test('renders payment-succeeded email with order vars and provider label', () => {
    const email = renderEmail('payment-succeeded', {
      name: '小明',
      orderId: 'order-1',
      amount: '25.00',
      currency: 'CNY',
      provider: 'wechat',
      paidAt: new Date().toISOString(),
    })
    expect(email.subject).toContain('支付成功')
    expect(email.html).toContain('¥25.00')
    expect(email.html).toContain('微信支付')
    expect(email.html).toContain('order-1')
  })

  test('renders refund-succeeded email with refund vars', () => {
    const email = renderEmail('refund-succeeded', {
      name: '小明',
      orderId: 'order-1',
      refundNo: 'rf-1',
      amount: '25.00',
      currency: 'CNY',
    })
    expect(email.subject).toContain('退款')
    expect(email.html).toContain('¥25.00')
    expect(email.html).toContain('rf-1')
  })

  test('renders order-shipped email; trackingNumber is optional', () => {
    const withTracking = renderEmail('order-shipped', {
      name: '小明',
      orderId: 'order-1',
      trackingNumber: 'SF123',
    })
    expect(withTracking.subject).toContain('发货')
    expect(withTracking.html).toContain('SF123')

    const withoutTracking = renderEmail('order-shipped', { name: '小明', orderId: 'order-1' })
    expect(withoutTracking.html).not.toContain('运单号')
  })

  test('throws on unknown template', () => {
    expect(() => renderEmail('nope' as never, {})).toThrow(/unknown email template/)
  })
})

describe('createMailer', () => {
  test('console transport logs and validates vars (missing vars throw)', async () => {
    const mailer = createMailer(createEnv(), logger)
    expect(mailer.transport).toBe('console')
    await expect(mailer.send('reset-password', 'a@b.com', {})).rejects.toThrow(/resetLink/)
    await mailer.send('welcome', 'a@b.com', { name: '小明' })
  })

  test('smtp transport fails fast when required fields are missing', () => {
    expect(() => createMailer(createEnv({ MAIL_TRANSPORT: 'smtp' }), logger)).toThrow(/SMTP_HOST/)
  })
})
