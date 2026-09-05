// 用户域邮件契约: 仅含注册/账户类模板; 交易/履约模板见 @epinfresh/notifications/jobs(tech-debt #27)。
export const EMAIL_JOB_NAMES = {
  WELCOME: 'welcome',
  RESET_PASSWORD: 'reset-password',
} as const

export type UserEmailTemplate = (typeof EMAIL_JOB_NAMES)[keyof typeof EMAIL_JOB_NAMES]

// 邮件发送能力端口(基础设施): template 为模板名(渲染层按 job 名排类型),
// worker 注入 console/smtp 实现, 领域不感知传输实现。
export interface EmailSender {
  send(template: string, to: string, vars: Record<string, unknown>): Promise<void>
}

// 邮件任务 payload 形状(@epinfresh/user/jobs 与本文件保持同构历史契约; 见 notifications/jobs)
export interface SendEmailJobData {
  to: string
  requestId?: string
  payload: Record<string, unknown>
}
