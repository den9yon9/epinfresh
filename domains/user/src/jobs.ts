export const EMAIL_QUEUE_NAME = 'email-tasks'

export const EMAIL_JOB_NAMES = {
  WELCOME: 'welcome',
  RESET_PASSWORD: 'reset-password',
} as const

export interface SendEmailJobData {
  to: string
  requestId?: string
  payload: Record<string, unknown>
}
