import { createDb, dbPlugin } from '@epinfresh/database'
import { type SendEmailJobData, getEmailQueue } from '@epinfresh/queue'
import { createRedisClient, redisPlugin } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { createLogger } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { env } from './env'

const logger = createLogger(env.LOG_LEVEL)
const isProduction = env.NODE_ENV === 'production'

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)
const emailQueue = getEmailQueue(env.REDIS_URL)

// ponytail: 只暴露 add,免得 bullmq 的复杂类型顺着 plugin 类型泄漏出去(TS2742)
export interface EmailQueueLike {
  add: (name: string, data: SendEmailJobData) => Promise<unknown>
}

export const storeDb = dbPlugin(db)
export const storeRedis = redisPlugin(redis, { logger })
export const storeSession = createSessionPlugin({
  redis,
  sessionSecret: env.SESSION_SECRET,
  isProduction,
  logger,
})
export const storeEmailQueue = new Elysia({ name: 'infra-email-queue' })
  .decorate('emailQueue', emailQueue as EmailQueueLike)
  .onStop(async () => {
    await emailQueue.close()
  })
export const storeAuthRateLimit = authRateLimit({
  redis,
  prefix: 'rl:auth',
  trustProxy: env.TRUST_PROXY,
})

export { logger, isProduction }
