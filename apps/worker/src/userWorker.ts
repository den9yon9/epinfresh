import { createDispatcher, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { emailHandlers } from '@epinfresh/user/handlers'
import { EMAIL_QUEUE_NAME } from '@epinfresh/user/jobs'

export function registerEmailWorker(redisUrl: string, logger: Logger): Worker {
  return createWorker(EMAIL_QUEUE_NAME, createDispatcher(emailHandlers, logger), {
    redisUrl,
    logger,
  })
}
