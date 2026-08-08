import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { healthCheck, requestLogger, securityHeaders, startServer } from '@epinfresh/http'
import { Elysia } from 'elysia'

import { createStorefrontDeps, type StorefrontAppOptions } from './deps'
import { createEnv } from './env'
import { createPlugins } from './plugins'
import { createOrderRoutes } from './routes/order'
import { createPaymentRoutes } from './routes/payment'
import { createProductRoutes } from './routes/product'
import { createUserRoutes } from './routes/user'

export function buildApp(options: StorefrontAppOptions) {
  const plugins = createPlugins(options)
  const enableDocs = !options.isProduction
  return new Elysia({ cookie: { secrets: options.sessionSecret, sign: ['session_id'] } })
    .use(requestLogger(options.logger))
    .use(securityHeaders(options.isProduction))
    .use(plugins.redisPlugin)
    .use(plugins.dbPlugin)
    .use(cors({ origin: options.corsOrigin, credentials: true }))
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
    .use(createUserRoutes(plugins))
    .use(createProductRoutes(plugins))
    .use(createOrderRoutes(plugins))
    .use(createPaymentRoutes(plugins))
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
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
