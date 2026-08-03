import { createWorker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

// ponytail: 只暴露 close, 免得 bullmq 的复杂类型顺着返回类型泄漏出去 (TS2742)
export interface EmailWorker {
  close: () => Promise<void>
}

export function registerEmailWorker(redisUrl: string, logger: Logger): EmailWorker {
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
  ) as EmailWorker
}
