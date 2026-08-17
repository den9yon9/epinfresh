import { createDb, type Db } from '@epinfresh/database'
import {
  createPaymentGatewaysFromEnv,
  type PaymentChannel,
  type PaymentGateway,
} from '@epinfresh/payment'
import { createRedisClient, type Redis } from '@epinfresh/redis'
import { createLogger, type Logger } from '@epinfresh/shared'

import { type AdminEnv } from './env'

export interface AdminAppOptions {
  db: Db
  redis: Redis
  paymentGateways: Record<PaymentChannel, PaymentGateway>
  sessionSecret: string
  corsOrigin: true | string | string[]
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

export function createAdminDeps(env: AdminEnv): AdminAppOptions {
  return {
    db: createDb(env.DATABASE_URL),
    redis: createRedisClient(env.REDIS_URL),
    // 渠道注册表由共享支付 env 助手构建(与 storefront-api/worker 同一来源)
    paymentGateways: createPaymentGatewaysFromEnv(process.env),
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
  }
}
