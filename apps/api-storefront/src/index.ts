import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  type InferModelsMap,
  commonModel,
  healthCheck,
  mapDbError,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/shared'
import { Elysia, status } from 'elysia'
import { env } from './env'
import { isProduction, logger, storeDb, storeEmailQueue, storeRedis } from './plugins'
import { checkoutRoutes } from './routes/checkout'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

export function buildApp() {
  const enableDocs = !isProduction
  return new Elysia()
    .use(requestLogger(logger))
    .use(securityHeaders(isProduction))
    .use(commonModel)
    .onError(({ error }) => {
      const mapped = mapDbError(error)
      if (mapped) return status(mapped.status, mapped.body)
    })
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
    .use(checkoutRoutes)
    .get('/health', ({ db, redis, set }) => healthCheck({ db, redis, set }))
}

if (import.meta.main) {
  startServer(buildApp(), {
    serviceName: 'storefront',
    port: Number(env.STOREFRONT_PORT),
    logger,
  })
}

export type App = ReturnType<typeof buildApp>
export type StorefrontModels = InferModelsMap<App>
