import { createTransactionalEmailHandlers } from '@epinfresh/notifications/handlers'
import { EMAIL_QUEUE_NAME } from '@epinfresh/notifications/jobs'
import { createDispatcher, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { createUserEmailHandlers } from '@epinfresh/user'

import type { WorkerEnv } from './env'
import type { Mailer } from './mailer'

export function registerEmailWorker(env: WorkerEnv, mailer: Mailer, logger: Logger): Worker {
  // 用户域模板(welcome/reset) + 交易履约模板(支付/退款/发货) 合并为一个 dispatcher,
  // 队列本质都是 email-tasks, 只在模板归属上按域拆分注册。
  const handlers = {
    ...createUserEmailHandlers(mailer, { webBaseUrl: env.STOREFRONT_WEB_URL }),
    ...createTransactionalEmailHandlers(mailer),
  }
  return createWorker(EMAIL_QUEUE_NAME, createDispatcher(handlers, logger), {
    redisUrl: env.REDIS_URL,
    logger,
    metrics: {},
  })
}
