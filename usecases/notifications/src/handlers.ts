import type { Logger } from '@epinfresh/shared'
import { type EmailSender } from '@epinfresh/user/jobs'

import { EMAIL_JOB_NAMES, type SendEmailJobData } from './jobs'

export type EmailJobHandler = (data: SendEmailJobData, logger: Logger) => void | Promise<void>

// 交易/履约邮件 handler: 纯透传 sender, 模板占位符数据已由 outbox 事件映射层(e.g. notifications
// service)包装成 payload; 与用户域 welcome/reset handler 分开注册(worker 侧合并 dispatcher)。
export function createTransactionalEmailHandlers(
  sender: EmailSender,
): Record<string, EmailJobHandler> {
  return {
    [EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED, data.to, data.payload),
    [EMAIL_JOB_NAMES.REFUND_SUCCEEDED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.REFUND_SUCCEEDED, data.to, data.payload),
    [EMAIL_JOB_NAMES.ORDER_SHIPPED]: (data) =>
      sender.send(EMAIL_JOB_NAMES.ORDER_SHIPPED, data.to, data.payload),
  }
}
