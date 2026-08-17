import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'

import { type AdminAppOptions } from './deps'

export interface AdminPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  rateLimitPlugin: ReturnType<typeof authRateLimit>
  paymentGateways: AdminAppOptions['paymentGateways']
  isProduction: boolean
  logger: Logger
}

export function createPlugins(options: Omit<AdminAppOptions, 'corsOrigin'>): AdminPlugins {
  const { db, redis, sessionSecret, trustProxy, isProduction, logger, paymentGateways } = options
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
    paymentGateways,
    isProduction,
    logger,
  }
}
