export type { SendEmailJobData } from '@epinfresh/user/jobs'

// 通知/交易履约邮件契约(归属: usecases/notifications):
// 用户域注册类模板(welcome/reset-password)仍归 domains/user/jobs;
// 本文件收敛交易/履约类模板与邮件队列全局契约(tech-debt #27)。
export const EMAIL_QUEUE_NAME = 'email-tasks'

export const EMAIL_JOB_NAMES = {
  PAYMENT_SUCCEEDED: 'payment-succeeded',
  REFUND_SUCCEEDED: 'refund-succeeded',
  ORDER_SHIPPED: 'order-shipped',
} as const

export type TransactionalEmailTemplate = (typeof EMAIL_JOB_NAMES)[keyof typeof EMAIL_JOB_NAMES]
