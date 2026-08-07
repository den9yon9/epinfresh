import { createDb } from '@epinfresh/database'
import { createQueue } from '@epinfresh/queue'
import { createRedisClient } from '@epinfresh/redis'
import { createLogger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

import { type StorefrontEnv } from './env'
import { type StorefrontAppOptions } from './index'

export function createStorefrontDeps(env: StorefrontEnv): StorefrontAppOptions {
  return {
    db: createDb(env.DATABASE_URL),
    redis: createRedisClient(env.REDIS_URL),
    emailQueue: createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl: env.REDIS_URL }),
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
  }
}
