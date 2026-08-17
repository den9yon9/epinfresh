import { readFileSync } from 'node:fs'

import { createDb, type Db } from '@epinfresh/database'
import {
  createPaymentGateways,
  type PaymentChannel,
  type PaymentGateway,
  type PaymentGatewayConfig,
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
  // 渠道注册表: mock 是"无加密快速通道"(e2e 依赖); wechat 走 APIv3 网关(联调指向 pay-mock-server)
  const gatewayConfigs: PaymentGatewayConfig[] =
    env.PAYMENT_GATEWAY === 'wechat'
      ? [
          {
            channel: 'wechat',
            config: {
              baseUrl: env.WECHAT_API_BASE,
              merchantId: env.WECHAT_MERCHANT_ID,
              appId: env.WECHAT_APP_ID,
              apiV3Key: env.WECHAT_API_V3_KEY,
              merchantSerialNo: env.WECHAT_MERCHANT_SERIAL_NO,
              merchantPrivateKey: readFileSync(env.WECHAT_MERCHANT_PRIVATE_KEY_PATH, 'utf8'),
              platformPublicKey: readFileSync(env.WECHAT_PLATFORM_PUBLIC_KEY_PATH, 'utf8'),
              notifyUrl: env.WECHAT_NOTIFY_URL,
            },
          },
        ]
      : [{ channel: 'mock' }]
  return {
    db: createDb(env.DATABASE_URL),
    redis,
    emailQueue: createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { connection: redis }),
    paymentGateways: createPaymentGateways(gatewayConfigs),
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
  }
}
