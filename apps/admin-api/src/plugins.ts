import { closeDb, createDb } from '@epinfresh/database'
import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { createRedisClient } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { createLogger } from '@epinfresh/shared'

import { env } from './env'

const logger = createLogger(env.LOG_LEVEL)
const isProduction = env.NODE_ENV === 'production'

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)

export const adminDb = dbPlugin(db)
export const adminRedis = redisPlugin(redis, { logger })
export const adminSession = createSessionPlugin({
  redis,
  sessionSecret: env.SESSION_SECRET,
  isProduction,
  logger,
})
export const adminRateLimit = authRateLimit({
  redis,
  prefix: 'rl:admin',
  trustProxy: env.TRUST_PROXY,
})

export { isProduction, logger }

export async function closeInfra(): Promise<void> {
  await Promise.allSettled([closeDb(db), redis.quit()])
}
