import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { type InferModelsMap, createApiServer } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { env } from './env'
import { isProduction, logger, storeDb, storeEmailQueue, storeRedis } from './plugins'
import { checkoutRoutes } from './routes/checkout'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const app = createApiServer({
  serviceName: 'storefront',
  port: Number(env.STOREFRONT_PORT),
  logger,
  isProduction,
  setup: (app) => {
    const enableDocs = !isProduction
    return app
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
  },
})

export type App = typeof app
export type StorefrontModels = InferModelsMap<typeof app>
