import { logger } from '@epinfresh/shared'
import { type Job, createQueue, createWorker } from '../index'

export interface SendEmailJobData {
  type: 'welcome' | 'reset-password'
  to: string
  payload: Record<string, unknown>
}

export const EMAIL_QUEUE_NAME = 'email-tasks'

export const emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME)

export function registerEmailWorker(handler?: (job: Job<SendEmailJobData>) => Promise<void>) {
  return createWorker<SendEmailJobData>(EMAIL_QUEUE_NAME, async (job) => {
    if (handler) {
      await handler(job)
      return
    }

    switch (job.data.type) {
      case 'welcome':
        logger.info({ to: job.data.to, payload: job.data.payload }, 'welcome email queued')
        break
      default:
        logger.warn({ type: job.data.type }, 'unknown email job type')
    }
  })
}
