import type { Logger } from '@epinfresh/shared'

import { EMAIL_JOB_NAMES, type SendEmailJobData } from './jobs'

export type EmailJobHandler = (data: SendEmailJobData, logger: Logger) => void | Promise<void>

export const emailHandlers: Record<string, EmailJobHandler> = {
  [EMAIL_JOB_NAMES.WELCOME]: (data, logger) => {
    logger.info({ to: data.to, payload: data.payload }, 'welcome email queued')
  },
  [EMAIL_JOB_NAMES.RESET_PASSWORD]: (data, logger) => {
    logger.info({ to: data.to, payload: data.payload }, 'reset-password email queued')
  },
}
