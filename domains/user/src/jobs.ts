export const EMAIL_QUEUE_NAME = 'email-tasks'

export const EMAIL_JOB_NAMES = {
  WELCOME: 'welcome',
  RESET_PASSWORD: 'reset-password',
  PAYMENT_SUCCEEDED: 'payment-succeeded',
} as const

// job 名即模板名: 消费端 (worker mailer) 按 template 渲染, 生产端只传业务 vars
export type EmailTemplate = (typeof EMAIL_JOB_NAMES)[keyof typeof EMAIL_JOB_NAMES]

// 邮件发送能力端口: 领域不感知传输实现 (console/smtp), 由 worker 注入
export interface EmailSender {
  send(template: EmailTemplate, to: string, vars: Record<string, unknown>): Promise<void>
}

export interface SendEmailJobData {
  to: string
  requestId?: string
  payload: Record<string, unknown>
}
