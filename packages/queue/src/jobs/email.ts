import { logger } from '@epinfresh/shared'
import { createQueue, createWorker } from '../index'

export interface SendEmailJobData {
  type: 'welcome' | 'reset-password'
  to: string
  payload: Record<string, unknown>
}

export const EMAIL_QUEUE_NAME = 'email-tasks'

export function getEmailQueue(redisUrl: string) {
  return createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl })
}

export function registerEmailWorker(redisUrl: string) {
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
    { redisUrl },
  )
}
