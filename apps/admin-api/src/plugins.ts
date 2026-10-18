import { dbPlugin, localePlugin, redisPlugin } from '@epinfresh/http'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'

import { type AdminAppOptions } from './deps'

export interface AdminPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  localePlugin: ReturnType<typeof localePlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  rateLimitPlugin: ReturnType<typeof authRateLimit>
  paymentGateways: AdminAppOptions['paymentGateways']
  isProduction: boolean
  logger: Logger
  authRateLimitPerMinute: number
}

export function createPlugins(options: Omit<AdminAppOptions, 'corsOrigin'>): AdminPlugins {
  const { db, redis, sessionSecret, trustProxy, isProduction, logger, paymentGateways } = options
  return {
    dbPlugin: dbPlugin(db),
    redisPlugin: redisPlugin(redis, { logger }),
    localePlugin: localePlugin({ defaultLocale: options.defaultLocale }),
    sessionPlugin: createSessionPlugin({
      redis,
      sessionSecret,
      isProduction,
      logger,
      defaultLocale: options.defaultLocale,
    }),
    rateLimitPlugin: authRateLimit({
      redis,
      prefix: 'rl:admin',
      trustProxy,
      defaultLocale: options.defaultLocale,
    }),
    paymentGateways,
    isProduction,
    logger,
    authRateLimitPerMinute: options.authRateLimitPerMinute,
  }
}
