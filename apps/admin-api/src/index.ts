import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  createMetrics,
  healthCheck,
  httpMetricsPlugin,
  registerHttpMetrics,
  renderMetrics,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/http'
import { Elysia } from 'elysia'

import { type AdminAppOptions, createAdminDeps } from './deps'
import { createEnv } from './env'
import { createPlugins } from './plugins'
import { createAuthRoutes } from './routes/auth'
import { createOrderRoutes } from './routes/order'
import { createProductRoutes } from './routes/product'
import { createUploadRoutes } from './routes/upload'
import { createUserRoutes } from './routes/user'

export function buildApp(options: AdminAppOptions) {
  const metrics = createMetrics()
  const httpMetrics = registerHttpMetrics(metrics)
  const plugins = createPlugins(options)
  const enableDocs = !options.isProduction
  return new Elysia({ cookie: { secrets: options.sessionSecret, sign: ['session_id'] } })
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
              info: { title: 'Epinfresh Admin API', version: '1.0.0' },
            },
          })
        : new Elysia(),
    )
    .use(plugins.rateLimitPlugin)
    .use(createAuthRoutes(plugins))
    .use(createUserRoutes(plugins))
    .use(createProductRoutes(plugins))
    .use(createOrderRoutes(plugins))
    .use(createUploadRoutes(plugins))
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
          summary: 'Prometheus 指标端点(Bun/HTTP 计数, text/plain)',
          description: '供监控平台抓取, 无鉴权(通常由内网/监控白名单访问)。',
        },
      },
    )
}

if (import.meta.main) {
  const env = createEnv()
  const deps = createAdminDeps(env)
  startServer(buildApp(deps), {
    serviceName: 'admin',
    port: Number(env.ADMIN_PORT),
    logger: deps.logger,
  })
}

export type App = ReturnType<typeof buildApp>
