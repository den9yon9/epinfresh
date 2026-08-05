import { createWorker } from '@epinfresh/queue'
import type { Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

export function registerEmailWorker(redisUrl: string, logger: Logger): Worker {
  return createWorker<SendEmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => {
      switch (job.data.type) {
        case 'welcome':
          logger.info({ to: job.data.to, payload: job.data.payload }, 'welcome email queued')
          break
        case 'reset-password':
          logger.info({ to: job.data.to, payload: job.data.payload }, 'reset-password email queued')
          break
      }
    },
    { redisUrl, logger },
  )
}
