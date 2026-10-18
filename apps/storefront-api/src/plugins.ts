import { type ShippingFeeConfig } from '@epinfresh/checkout'
import {
  type Counter,
  dbPlugin,
  type HttpMetricsBundle,
  localePlugin,
  redisPlugin,
} from '@epinfresh/http'
import { type Locale } from '@epinfresh/i18n'
import { type SendEmailJobData } from '@epinfresh/notifications/jobs'
import { type PaymentChannel, type PaymentGateway } from '@epinfresh/payment'
import { type Queue } from '@epinfresh/queue'
import { type Redis } from '@epinfresh/redis'
import { authRateLimit, createSessionPlugin } from '@epinfresh/session'
import { type Logger } from '@epinfresh/shared'
import { Elysia } from 'elysia'

import { type StorefrontAppOptions, type WechatOauthConfig } from './deps'

export interface StorefrontMetrics {
  http: HttpMetricsBundle
  // 支付回调验签结果(渠道为标签; result: accepted | rejected)
  paymentWebhook: Counter<string>
}

export interface StorefrontPlugins {
  dbPlugin: ReturnType<typeof dbPlugin>
  redisPlugin: ReturnType<typeof redisPlugin>
  localePlugin: ReturnType<typeof localePlugin>
  sessionPlugin: ReturnType<typeof createSessionPlugin>
  emailQueuePlugin: ReturnType<typeof createEmailQueuePlugin>
  authRateLimit: ReturnType<typeof authRateLimit>
  paymentGateways: Record<PaymentChannel, PaymentGateway>
  wechatOauth: WechatOauthConfig
  shippingFeeConfig: ShippingFeeConfig
  metrics: StorefrontMetrics
  isProduction: boolean
  logger: Logger
  authRateLimitPerMinute: number
  defaultLocale: Locale
}

function createEmailQueuePlugin(emailQueue: Queue<SendEmailJobData>, queueRedis: Redis) {
  return new Elysia({ name: 'infra-email-queue' })
    .decorate('emailQueue', emailQueue)
    .onStop(async () => {
      await emailQueue.close()
      // bullmq 传实例时不接管连接生命周期: 生产者专用连接在此显式释放
      await queueRedis.quit()
    })
}

export function createPlugins(
  options: Omit<StorefrontAppOptions, 'corsOrigin'>,
  metrics: StorefrontMetrics,
): StorefrontPlugins {
  const {
    db,
    redis,
    queueRedis,
    emailQueue,
    paymentGateways,
    wechatOauth,
    shippingFeeConfig,
    sessionSecret,
    trustProxy,
    isProduction,
    logger,
  } = options
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
    emailQueuePlugin: createEmailQueuePlugin(emailQueue, queueRedis),
    authRateLimit: authRateLimit({
      redis,
      prefix: 'rl:auth',
      trustProxy,
      defaultLocale: options.defaultLocale,
    }),
    paymentGateways,
    wechatOauth,
    shippingFeeConfig,
    metrics,
    isProduction,
    logger,
    authRateLimitPerMinute: options.authRateLimitPerMinute,
    defaultLocale: options.defaultLocale,
  }
}
