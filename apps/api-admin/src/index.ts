import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { type InferModelsMap, createApiServer } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { env } from './env'
import { adminDb, adminRateLimit, adminRedis, isProduction, logger } from './plugins'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const app = createApiServer({
  serviceName: 'admin',
  port: Number(env.ADMIN_PORT),
  logger,
  isProduction,
  setup: (app) => {
    const enableDocs = !isProduction
    return app
      .use(adminRedis)
      .use(adminDb)
      .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
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
      .use(adminRateLimit)
      .use(userRoutes)
      .use(productRoutes)
  },
})

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
