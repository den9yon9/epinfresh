import { createDispatcher, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { createEmailHandlers } from '@epinfresh/user'
import { EMAIL_QUEUE_NAME } from '@epinfresh/user/jobs'

import type { WorkerEnv } from './env'
import type { Mailer } from './mailer'

export function registerEmailWorker(env: WorkerEnv, mailer: Mailer, logger: Logger): Worker {
  return createWorker(
    EMAIL_QUEUE_NAME,
    createDispatcher(createEmailHandlers(mailer, { webBaseUrl: env.STOREFRONT_WEB_URL }), logger),
    {
      redisUrl: env.REDIS_URL,
      logger,
      metrics: {},
    },
  )
}
