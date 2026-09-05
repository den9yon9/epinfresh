import {
  gramsOr,
  parseCommaList,
  type ShippingFeeConfig,
  yuanToCentsOrNull,
  yuanToCentsOrZero,
} from '@epinfresh/checkout'
import { createDb, type Db } from '@epinfresh/database'
import {
  createPaymentGatewaysFromEnv,
  type PaymentChannel,
  paymentEnvSchema,
  type PaymentGateway,
} from '@epinfresh/payment'
import { createQueue, type Queue } from '@epinfresh/queue'
import { createRedisClient, type Redis } from '@epinfresh/redis'
import { createLogger, type Logger, parseEnv } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

import { type StorefrontEnv } from './env'

export interface WechatOauthConfig {
  // 是否启用(PAYMENT_GATEWAY 含 wechat 且有 appSecret)
  enabled: boolean
  // 授权页(open.weixin.qq.com)
  baseUrl: string
  // 公众号 API(token/ticket/sns, api.weixin.qq.com)
  apiBase: string
  appId: string
  appSecret: string
}

export interface StorefrontAppOptions {
  db: Db
  redis: Redis
  // BullMQ 生产者专用连接(bullmq close() 不释放传入实例, 由 emailQueuePlugin.onStop quit)
  queueRedis: Redis
  emailQueue: Queue<SendEmailJobData>
  paymentGateways: Record<PaymentChannel, PaymentGateway>
  wechatOauth: WechatOauthConfig
  shippingFeeConfig: ShippingFeeConfig
  sessionSecret: string
  corsOrigin: true | string | string[]
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
  authRateLimitPerMinute: number
}

export function createStorefrontDeps(env: StorefrontEnv): StorefrontAppOptions {
  // session/限流与 BullMQ 生产者使用独立连接: 隔离连接级故障(断线重连风暴、
  // 慢命令阻塞互不牵连)。实例级拆分(双 Redis)的触发条件 = 队列流量影响会话延迟时。
  const redis = createRedisClient(env.REDIS_URL)
  const queueRedis = createRedisClient(env.REDIS_URL)
  // 共享支付 env: 渠道注册表 + 公众号 OAuth/JS-SDK 配置(同一来源, 避免二次定义)
  const paymentEnv = parseEnv(paymentEnvSchema, process.env)
  return {
    db: createDb(env.DATABASE_URL),
    redis,
    queueRedis,
    emailQueue: createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { connection: queueRedis }),
    // 渠道注册表由共享支付 env 助手构建(storefront/admin/worker 三进程同一来源)
    paymentGateways: createPaymentGatewaysFromEnv(process.env),
    // 运费策略: env(元字符串) → 分; 阈值空 = 不启用包邮; 偏远省份/首重续重同理
    shippingFeeConfig: {
      flatFeeCents: yuanToCentsOrZero(env.SHIPPING_FLAT_FEE),
      freeThresholdCents: yuanToCentsOrNull(env.FREE_SHIPPING_THRESHOLD),
      remoteProvinces: parseCommaList(env.SHIPPING_REMOTE_PROVINCES),
      remoteFeeCents: yuanToCentsOrZero(env.SHIPPING_REMOTE_FEE),
      weightBaseGrams: gramsOr(env.SHIPPING_WEIGHT_BASE_GRAMS, 1000),
      weightAdditionalGrams: gramsOr(env.SHIPPING_WEIGHT_ADDITIONAL_GRAMS, 1000),
      weightAdditionalFeeCents: yuanToCentsOrZero(env.SHIPPING_WEIGHT_ADDITIONAL_FEE),
    },
    wechatOauth: {
      enabled:
        paymentEnv.PAYMENT_GATEWAY.includes('wechat') && paymentEnv.WECHAT_APP_SECRET.length > 0,
      baseUrl: paymentEnv.WECHAT_OAUTH_BASE,
      apiBase: paymentEnv.WECHAT_OAUTH_API_BASE,
      appId: paymentEnv.WECHAT_APP_ID,
      appSecret: paymentEnv.WECHAT_APP_SECRET,
    },
    sessionSecret: env.SESSION_SECRET,
    corsOrigin: env.CORS_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
    logger: createLogger(env.LOG_LEVEL),
    authRateLimitPerMinute: Number(env.AUTH_RATE_LIMIT_PER_MINUTE),
  }
}
