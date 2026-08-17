import { createDb, type Db } from '@epinfresh/database'
import {
  createPaymentGatewaysFromEnv,
  type PaymentChannel,
  type PaymentGateway,
} from '@epinfresh/payment'
import { createQueue, type Queue } from '@epinfresh/queue'
import { createRedisClient, type Redis } from '@epinfresh/redis'
import { createLogger, type Logger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

import { type StorefrontEnv } from './env'

export interface StorefrontAppOptions {
  db: Db
  redis: Redis
  emailQueue: Queue<SendEmailJobData>
  paymentGateways: Record<PaymentChannel, PaymentGateway>
  sessionSecret: string
  corsOrigin: true | string | string[]
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

export function createStorefrontDeps(env: StorefrontEnv): StorefrontAppOptions {
  // 单条 Redis 连接全进程共享: session/rateLimit 直接用, BullMQ(生产者)复用同一实例
  // (bullmq v5 传实例即自动共享, close() 不会释放, 由 redisPlugin.onStop 统一 quit)
  const redis = createRedisClient(env.REDIS_URL)
  return {
    db: createDb(env.DATABASE_URL),
    redis,
    emailQueue: createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { connection: redis }),
    // 渠道注册表由共享支付 env 助手构建(storefront/admin/worker 三进程同一来源)
    paymentGateways: createPaymentGatewaysFromEnv(process.env),
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
  }
}
