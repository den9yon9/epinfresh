import { type Db } from '@epinfresh/database'
import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { type Redis } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'

export interface AdminPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  rateLimitPlugin: ReturnType<typeof authRateLimit>
  isProduction: boolean
  logger: Logger
}

export interface AdminPluginsOptions {
  db: Db
  redis: Redis
  sessionSecret: string
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

export function createPlugins(options: AdminPluginsOptions): AdminPlugins {
  const { db, redis, sessionSecret, trustProxy, isProduction, logger } = options
  return {
    dbPlugin: dbPlugin(db),
    redisPlugin: redisPlugin(redis, { logger }),
    sessionPlugin: createSessionPlugin({
      redis,
      sessionSecret,
      isProduction,
      logger,
    }),
    rateLimitPlugin: authRateLimit({
      redis,
      prefix: 'rl:admin',
      trustProxy,
    }),
    isProduction,
    logger,
  }
}
