import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  commonModel,
  healthCheck,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/http'
import { Elysia } from 'elysia'

import { env } from './env'
import { isProduction, logger, storeDb, storeEmailQueue, storeRedis } from './plugins'
import { orderRoutes } from './routes/order'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

export function buildApp() {
  const enableDocs = !isProduction
  return new Elysia()
    .use(requestLogger(logger))
    .use(securityHeaders(isProduction))
    .use(commonModel)
    .use(storeRedis)
    .use(storeDb)
    .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
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
    .use(storeEmailQueue)
    .use(userRoutes)
    .use(productRoutes)
    .use(orderRoutes)
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
}

if (import.meta.main) {
  startServer(buildApp(), {
    serviceName: 'storefront',
    port: Number(env.STOREFRONT_PORT),
    logger,
  })
}

export type App = ReturnType<typeof buildApp>
