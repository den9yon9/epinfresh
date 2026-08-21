import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { healthCheck, requestLogger, securityHeaders, startServer } from '@epinfresh/http'
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
  const plugins = createPlugins(options)
  const enableDocs = !options.isProduction
  return new Elysia({
    cookie: { secrets: options.sessionSecret, sign: ['session_id', 'wechat_openid'] },
  })
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
