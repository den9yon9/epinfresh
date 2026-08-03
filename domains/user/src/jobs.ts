export const EMAIL_QUEUE_NAME = 'email-tasks'

export interface SendEmailJobData {
  type: 'welcome' | 'reset-password'
  to: string
  payload: Record<string, unknown>
}
