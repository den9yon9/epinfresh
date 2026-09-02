import { InvariantViolation, type Logger } from '@epinfresh/shared'

import { EMAIL_JOB_NAMES, type EmailSender, type SendEmailJobData } from './jobs'

export type EmailJobHandler = (data: SendEmailJobData, logger: Logger) => void | Promise<void>

export interface EmailHandlerOptions {
  // storefront-web 地址: 用于拼找回密码的重置链接
  webBaseUrl: string
}

// 工厂注入 EmailSender (worker 侧 console/smtp 实现) + 部署配置;
// handler 只做 job → 模板 vars 的映射, 渲染与传输都在 sender 内部。
// 发送失败抛错 → BullMQ 重试 (默认 3 次指数退避)。
export function createEmailHandlers(
  sender: EmailSender,
  opts: EmailHandlerOptions,
): Record<string, EmailJobHandler> {
  return {
    [EMAIL_JOB_NAMES.WELCOME]: (data) =>
      sender.send(EMAIL_JOB_NAMES.WELCOME, data.to, data.payload),
    [EMAIL_JOB_NAMES.RESET_PASSWORD]: (data) => {
      const token = data.payload.token
      if (typeof token !== 'string' || token.length === 0) {
        throw new InvariantViolation('reset-password job payload requires "token"')
      }
      return sender.send(EMAIL_JOB_NAMES.RESET_PASSWORD, data.to, {
        resetLink: `${opts.webBaseUrl}/reset-password?token=${token}`,
      })
    },
    [EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED, data.to, data.payload),
    [EMAIL_JOB_NAMES.REFUND_SUCCEEDED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.REFUND_SUCCEEDED, data.to, data.payload),
    [EMAIL_JOB_NAMES.ORDER_SHIPPED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.ORDER_SHIPPED, data.to, data.payload),
  }
}
