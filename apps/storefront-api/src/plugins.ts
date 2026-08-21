import { dbPlugin, redisPlugin } from '@epinfresh/http'
import { type PaymentChannel, type PaymentGateway } from '@epinfresh/payment'
import { type Queue } from '@epinfresh/queue'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'
import { type SendEmailJobData } from '@epinfresh/user/jobs'
import { Elysia } from 'elysia'

import { type StorefrontAppOptions, type WechatOauthConfig } from './deps'

export interface StorefrontPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  emailQueuePlugin: ReturnType<typeof createEmailQueuePlugin>
  authRateLimit: ReturnType<typeof authRateLimit>
  paymentGateways: Record<PaymentChannel, PaymentGateway>
  wechatOauth: WechatOauthConfig
  isProduction: boolean
  logger: Logger
}

function createEmailQueuePlugin(emailQueue: Queue<SendEmailJobData>) {
  return new Elysia({ name: 'infra-email-queue' })
    .decorate('emailQueue', emailQueue)
    .onStop(async () => {
      await emailQueue.close()
    })
}

export function createPlugins(
  options: Omit<StorefrontAppOptions, 'corsOrigin'>,
): StorefrontPlugins {
  const {
    db,
    redis,
    emailQueue,
    paymentGateways,
    wechatOauth,
    sessionSecret,
    trustProxy,
    isProduction,
    logger,
  } = options
  return {
    dbPlugin: dbPlugin(db),
    redisPlugin: redisPlugin(redis, { logger }),
    sessionPlugin: createSessionPlugin({
      redis,
      sessionSecret,
      isProduction,
      logger,
    }),
    emailQueuePlugin: createEmailQueuePlugin(emailQueue),
    authRateLimit: authRateLimit({
      redis,
      prefix: 'rl:auth',
      trustProxy,
    }),
    paymentGateways,
    wechatOauth,
    isProduction,
    logger,
  }
}
