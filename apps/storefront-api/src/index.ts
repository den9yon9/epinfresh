import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  createMetrics,
  healthCheck,
  httpMetricsPlugin,
  registerBusinessMetric,
  registerHttpMetrics,
  renderMetrics,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/http'
import { Elysia } from 'elysia'

import { createStorefrontDeps, type StorefrontAppOptions } from './deps'
import { createEnv } from './env'
import { createPlugins } from './plugins'
import { createAddressRoutes } from './routes/address'
import { createCartRoutes } from './routes/cart'
import { createOrderRoutes } from './routes/order'
import { createPaymentRoutes } from './routes/payment'
import { createProductRoutes } from './routes/product'
import { createUserRoutes } from './routes/user'
import { createWechatRoutes } from './routes/wechat'

export function buildApp(options: StorefrontAppOptions) {
  // 监控指标: 进程级 Registry + HTTP/业务计数, /metrics 端点随 buildApp 挂载
  const metrics = createMetrics()
  const httpMetrics = registerHttpMetrics(metrics)
  const paymentWebhook = registerBusinessMetric(
    metrics,
    'payment_webhook_results_total',
    'Payment webhook verification results by channel',
    ['channel', 'result'],
  )
  const plugins = createPlugins(options, { http: httpMetrics, paymentWebhook })
  const enableDocs = !options.isProduction
  return new Elysia({
    cookie: {
      secrets: options.sessionSecret,
      sign: ['session_id', 'wechat_openid', 'wechat_oauth_state'],
    },
  })
    .use(httpMetricsPlugin(httpMetrics))
    .use(requestLogger(options.logger))
    .use(securityHeaders(options.isProduction))
    .use(plugins.redisPlugin)
    .use(plugins.dbPlugin)
    .use(cors({ origin: options.corsOrigin, credentials: true, exposeHeaders: ['x-request-id'] }))
    .use(
      enableDocs
        ? openapi({
            path: '/docs',
            documentation: {
              info: { title: 'Epinfresh Storefront API', version: '1.0.0' },
            },
          })
        : new Elysia(),
    )
    .use(plugins.emailQueuePlugin)
    .use(createAddressRoutes(plugins))
    .use(createCartRoutes(plugins))
    .use(createUserRoutes(plugins))
    .use(createProductRoutes(plugins))
    .use(createOrderRoutes(plugins))
    .use(createPaymentRoutes(plugins))
    .use(createWechatRoutes(plugins, options.corsOrigin))
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
    .get(
      '/metrics',
      async () =>
        new Response(await renderMetrics(metrics), {
          headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
        }),
      {
        detail: {
          tags: ['System'],
          summary: 'Prometheus 指标端点(Bun/HTTP/业务计数, text/plain)',
          description: '供监控平台抓取, 无鉴权(通常由内网/监控白名单访问)。',
        },
      },
    )
}

if (import.meta.main) {
  const env = createEnv()
  const deps = createStorefrontDeps(env)
  startServer(buildApp(deps), {
    serviceName: 'storefront',
    port: Number(env.STOREFRONT_PORT),
    logger: deps.logger,
  })
}

export type App = ReturnType<typeof buildApp>
