import {
  createTranslator,
  DEFAULT_LOCALE,
  type Locale,
  type TranslateParams,
} from '@epinfresh/i18n'
import type { TransactionalEmailTemplate } from '@epinfresh/notifications/jobs'
import type { UserEmailTemplate } from '@epinfresh/user/jobs'

// 生效模板 = 用户域(welcome/reset) ∪ 交易履约(payment/refund/order)
export type EmailTemplate = UserEmailTemplate | TransactionalEmailTemplate

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

type Translator = (source: string, params?: TranslateParams) => string

// 极简外层布局: 纯文本为主的通知邮件, 不引入模板引擎
function layout(title: string, bodyHtml: string, i18n: Translator): string {
  return [
    "<div style=\"font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;",
    ' max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">',
    `<h2 style="font-size: 18px; margin: 0 0 16px;">${title}</h2>`,
    bodyHtml,
    `<p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">${i18n('epinfresh · Fresh to your door')}</p>`,
    '</div>',
  ].join('')
}

function paragraphs(lines: string[]): string {
  return lines.map((line) => `<p style="margin: 0 0 12px; line-height: 1.6;">${line}</p>`).join('')
}

function nonEmpty(vars: Record<string, unknown>, key: string): string | undefined {
  const value = vars[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireString(vars: Record<string, unknown>, key: string, template: string): string {
  const value = nonEmpty(vars, key)
  if (value === undefined) throw new Error(`${template} email requires "${key}" var`)
  return value
}

// 渲染失败 (未知模板/缺 vars) 抛错 → 邮件 job 进 BullMQ 重试
export function renderEmail(
  template: EmailTemplate,
  vars: Record<string, unknown>,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const i18n = createTranslator(locale)
  const name = nonEmpty(vars, 'name') ?? i18n('Friend')
  const greeting = i18n('Hello, {name}!', { name })
  // 显示名映射: 字面量在此标记(可被提取器扫描), 再按渠道/承运商码取值
  const providerLabel: Record<string, string> = {
    wechat: i18n('WeChat Pay'),
    alipay: i18n('Alipay'),
    mock: i18n('Test channel'),
  }
  const courierLabel: Record<string, string> = {
    sf: i18n('SF Express'),
    zto: i18n('ZTO Express'),
    yto: i18n('YTO Express'),
    jd: i18n('JD Logistics'),
    ems: i18n('EMS'),
  }

  switch (template) {
    case 'welcome': {
      const body = i18n('Your account has been created. Enjoy shopping for fresh groceries.')
      return {
        subject: i18n('Welcome to epinfresh'),
        html: layout(i18n('Welcome to epinfresh'), paragraphs([greeting, body]), i18n),
        text: `${greeting}${body}`,
      }
    }
    case 'reset-password': {
      const resetLink = requireString(vars, 'resetLink', 'reset-password')
      return {
        subject: i18n('Reset your password'),
        html: layout(
          i18n('Reset your password'),
          paragraphs([
            i18n(
              'We received your password reset request. Click the link below to set a new password:',
            ),
            `<a href="${resetLink}">${resetLink}</a>`,
            i18n(
              'If you did not request this, please ignore this email; your account will not be affected.',
            ),
          ]),
          i18n,
        ),
        text: [
          i18n(
            'We received your password reset request. Open the link to set a new password: {resetLink}',
            { resetLink },
          ),
          i18n('If you did not request this, please ignore this email.'),
        ].join('\n'),
      }
    }
    case 'payment-succeeded': {
      const orderId = requireString(vars, 'orderId', 'payment-succeeded')
      const amount = requireString(vars, 'amount', 'payment-succeeded')
      const currency = requireString(vars, 'currency', 'payment-succeeded')
      const provider = requireString(vars, 'provider', 'payment-succeeded')
      const channel = providerLabel[provider] ?? provider
      const subject = i18n('Payment successful · Order confirmed')
      const lines = [
        greeting,
        i18n('Your order has been paid successfully:'),
        i18n('Amount: ¥{amount} ({currency}) · Channel: {channel}', { amount, currency, channel }),
        i18n('Order number: {orderId}', { orderId }),
        i18n('We will arrange picking and shipping soon. Track progress in "My Orders".'),
      ]
      return {
        subject,
        html: layout(subject, paragraphs(lines), i18n),
        text: lines.join('\n'),
      }
    }
    case 'refund-succeeded': {
      const orderId = requireString(vars, 'orderId', 'refund-succeeded')
      const refundNo = requireString(vars, 'refundNo', 'refund-succeeded')
      const amount = requireString(vars, 'amount', 'refund-succeeded')
      const currency = requireString(vars, 'currency', 'refund-succeeded')
      const subject = i18n('Refund successful')
      const lines = [
        greeting,
        i18n(
          'Your refund was successful: ¥{amount} ({currency}) will be returned to the original payment method.',
          { amount, currency },
        ),
        i18n('Order number: {orderId} · Refund number: {refundNo}', { orderId, refundNo }),
        i18n('The arrival time depends on the payment channel, usually within 1-3 business days.'),
      ]
      return {
        subject,
        html: layout(subject, paragraphs(lines), i18n),
        text: lines.join('\n'),
      }
    }
    case 'order-shipped': {
      const orderId = requireString(vars, 'orderId', 'order-shipped')
      const trackingNumber = nonEmpty(vars, 'trackingNumber')
      const courier = courierLabel[nonEmpty(vars, 'courierCompany') ?? '']
      const subject = i18n('Order shipped')
      const lines = [
        greeting,
        i18n('Your order has been shipped and is on its way to your table.'),
        i18n('Order number: {orderId}', { orderId }),
      ]
      if (courier) lines.push(i18n('Courier: {courier}', { courier }))
      if (trackingNumber) lines.push(i18n('Tracking number: {trackingNumber}', { trackingNumber }))
      lines.push(i18n('You can track logistics progress in "My Orders".'))
      return {
        subject,
        html: layout(subject, paragraphs(lines), i18n),
        text: lines.join('\n'),
      }
    }
    default: {
      // EmailTemplate 联合已穷举, 运行时仅防未知字符串 (job 名与模板漂移)
      throw new Error(`unknown email template: ${template}`)
    }
  }
}
