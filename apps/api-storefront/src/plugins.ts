import { createDb } from '@epinfresh/database'
import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { createQueue } from '@epinfresh/queue'
import { createRedisClient } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { createLogger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'
import { Elysia } from 'elysia'
import { env } from './env'

const logger = createLogger(env.LOG_LEVEL)
const isProduction = env.NODE_ENV === 'production'

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)
const emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl: env.REDIS_URL })

export const storeDb = dbPlugin(db)
export const storeRedis = redisPlugin(redis, { logger })
export const storeSession = createSessionPlugin({
  redis,
  sessionSecret: env.SESSION_SECRET,
  isProduction,
  logger,
})
export const storeEmailQueue = new Elysia({ name: 'infra-email-queue' })
  .decorate('emailQueue', emailQueue)
  .onStop(async () => {
    await emailQueue.close()
  })
export const storeAuthRateLimit = authRateLimit({
  redis,
  prefix: 'rl:auth',
  trustProxy: env.TRUST_PROXY,
})

export { logger, isProduction }
