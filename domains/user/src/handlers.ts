import type { Logger } from '@epinfresh/shared'

import { EMAIL_JOB_NAMES, type SendEmailJobData } from './jobs'

export type EmailJobHandler = (data: SendEmailJobData, logger: Logger) => void | Promise<void>

export const emailHandlers: Record<string, EmailJobHandler> = {
  [EMAIL_JOB_NAMES.WELCOME]: (data, logger) => {
    logger.info({ to: data.to, payload: data.payload }, 'welcome email queued')
  },
  [EMAIL_JOB_NAMES.RESET_PASSWORD]: (data, logger) => {
    const token = data.payload.token
    // ponytail: mock 只打日志; 接真实邮件服务时把 token 拼进重置链接发送
    logger.info(
      {
        to: data.to,
        resetLink: `http://localhost:3001/reset-password?token=${token}`,
      },
      'password reset email queued',
    )
  },
}
