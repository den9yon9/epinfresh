import { type Worker, createDispatcher, createWorker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { EMAIL_JOB_NAMES, EMAIL_QUEUE_NAME, type SendEmailJobData } from './jobs'

export function registerEmailWorker(redisUrl: string, logger: Logger): Worker {
  return createWorker<SendEmailJobData>(
    EMAIL_QUEUE_NAME,
    createDispatcher<SendEmailJobData>(
      {
        [EMAIL_JOB_NAMES.WELCOME]: (data) => {
          logger.info({ to: data.to, payload: data.payload }, 'welcome email queued')
        },
        [EMAIL_JOB_NAMES.RESET_PASSWORD]: (data) => {
          logger.info({ to: data.to, payload: data.payload }, 'reset-password email queued')
        },
      },
      logger,
    ),
    { redisUrl, logger },
  )
}
