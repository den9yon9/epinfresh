import { createDb } from '@epinfresh/database'
import { createRedisClient } from '@epinfresh/redis'
import { createLogger } from '@epinfresh/shared'

import { type AdminEnv } from './env'
import { type AdminAppOptions } from './index'

export function createAdminDeps(env: AdminEnv): AdminAppOptions {
  return {
    db: createDb(env.DATABASE_URL),
    redis: createRedisClient(env.REDIS_URL),
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
  }
}
