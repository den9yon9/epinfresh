import { type Db } from '@epinfresh/database'
import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { type PaymentGateway } from '@epinfresh/payment'
import { type Queue } from '@epinfresh/queue'
import { type Redis } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'
import { type SendEmailJobData } from '@epinfresh/user/jobs'
import { Elysia } from 'elysia'

export interface StorefrontPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  emailQueuePlugin: ReturnType<typeof createEmailQueuePlugin>
  authRateLimit: ReturnType<typeof authRateLimit>
  paymentGateway: PaymentGateway
  isProduction: boolean
  logger: Logger
}

export interface StorefrontPluginsOptions {
  db: Db
  redis: Redis
  emailQueue: Queue<SendEmailJobData>
  paymentGateway: PaymentGateway
  sessionSecret: string
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

function createEmailQueuePlugin(emailQueue: Queue<SendEmailJobData>) {
  return new Elysia({ name: 'infra-email-queue' })
    .decorate('emailQueue', emailQueue)
    .onStop(async () => {
      await emailQueue.close()
    })
}

export function createPlugins(options: StorefrontPluginsOptions): StorefrontPlugins {
  const { db, redis, emailQueue, paymentGateway, sessionSecret, trustProxy, isProduction, logger } =
    options
  return {
    dbPlugin: dbPlugin(db),
    redisPlugin: redisPlugin(redis, { logger }),
    sessionPlugin: createSessionPlugin({
      redis,
      sessionSecret,
      isProduction,
      logger,
    }),
    emailQueuePlugin: createEmailQueuePlugin(emailQueue),
    authRateLimit: authRateLimit({
      redis,
      prefix: 'rl:auth',
      trustProxy,
    }),
    paymentGateway,
    isProduction,
    logger,
  }
}
