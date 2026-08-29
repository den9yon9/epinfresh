import type { EmailTemplate } from '@epinfresh/user/jobs'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// 极简外层布局: 纯文本为主的中文通知邮件, 不引入模板引擎
function layout(title: string, bodyHtml: string): string {
  return [
    "<div style=\"font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;",
    ' max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">',
    `<h2 style="font-size: 18px; margin: 0 0 16px;">${title}</h2>`,
    bodyHtml,
    '<p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">epinfresh · 生鲜到家</p>',
    '</div>',
  ].join('')
}

function paragraphs(lines: string[]): string {
  return lines.map((line) => `<p style="margin: 0 0 12px; line-height: 1.6;">${line}</p>`).join('')
}

export interface PaymentSucceededVars {
  name: string
  orderId: string
  amount: string
  currency: string
  provider: string
  paidAt: string
}

const PROVIDER_LABEL: Record<string, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  mock: '测试渠道',
}

// 渲染失败 (未知模板/缺 vars) 抛错 → 邮件 job 进 BullMQ 重试
export function renderEmail(template: EmailTemplate, vars: Record<string, unknown>): RenderedEmail {
  switch (template) {
    case 'welcome': {
      const name = String(vars.name ?? '朋友')
      return {
        subject: '欢迎加入 epinfresh',
        html: layout(
          '欢迎加入 epinfresh',
          paragraphs([`你好，${name}！`, '你的账号已创建成功，欢迎选购新鲜好物。']),
        ),
        text: `你好，${name}！你的账号已创建成功，欢迎选购新鲜好物。`,
      }
    }
    case 'reset-password': {
      if (typeof vars.resetLink !== 'string' || vars.resetLink.length === 0) {
        throw new Error('reset-password email requires "resetLink" var')
      }
      const resetLink = vars.resetLink
      return {
        subject: '重置你的密码',
        html: layout(
          '重置你的密码',
          paragraphs([
            '我们收到了你的密码重置请求。点击下面的链接设置新密码：',
            `<a href="${resetLink}">${resetLink}</a>`,
            '如非本人操作，请忽略本邮件，你的账号不会受影响。',
          ]),
        ),
        text: `我们收到了你的密码重置请求。打开链接设置新密码：${resetLink}\n如非本人操作，请忽略本邮件。`,
      }
    }
    case 'payment-succeeded': {
      const { name, orderId, amount, currency, provider, paidAt } =
        vars as Partial<PaymentSucceededVars>
      if (!name || !orderId || !amount || !currency || !provider || !paidAt) {
        throw new Error(
          'payment-succeeded email requires name/orderId/amount/currency/provider/paidAt vars',
        )
      }
      const channel = PROVIDER_LABEL[provider] ?? provider
      return {
        subject: '支付成功 · 订单已确认',
        html: layout(
          '支付成功 · 订单已确认',
          paragraphs([
            `你好，${name}！`,
            `你的订单已支付成功：`,
            `金额：¥${amount}（${currency}） · 渠道：${channel}`,
            `订单编号：${orderId}`,
            '我们将尽快为你安排拣货发货，可在「我的订单」中查看进度。',
          ]),
        ),
        text: `你好，${name}！你的订单已支付成功：金额 ¥${amount}（${currency}），渠道 ${channel}，订单编号 ${orderId}。我们将尽快为你安排发货。`,
      }
    }
    default: {
      // EmailTemplate 联合已穷举, 运行时仅防未知字符串 (job 名与模板漂移)
      throw new Error(`unknown email template: ${template}`)
    }
  }
}
