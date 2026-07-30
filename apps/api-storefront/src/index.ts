import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, getSql, initDb } from '@epinfresh/database'
import { closeRedis, getRedis, initRedis } from '@epinfresh/redis'
import { type InferModelsMap, createApiServer, loadEnv } from '@epinfresh/shared'
import { storefrontEnvSchema } from './env'
import { checkoutRoutes } from './routes/checkout'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const env = loadEnv(storefrontEnvSchema)

const app = createApiServer({
  serviceName: 'storefront',
  port: Number(env.STOREFRONT_PORT),
  initResources: () => {
    initDb(env.DATABASE_URL)
    initRedis(env.REDIS_URL)
  },
  closeResources: async () => {
    await closeDb()
    await closeRedis()
  },
  healthCheck: async () => {
    let dbOk = false
    let redisOk = false
    try {
      await getSql()`SELECT 1`
      dbOk = true
    } catch {}
    try {
      await getRedis().ping()
      redisOk = true
    } catch {}
    return { db: dbOk, redis: redisOk }
  },
  setup: (app) =>
    app
      .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
      .use(
        openapi({
          path: '/docs',
          documentation: {
            info: { title: 'Epinfresh Storefront API', version: '1.0.0' },
          },
        }),
      )
      .use(userRoutes)
      .use(productRoutes)
      .use(checkoutRoutes),
})

export type App = typeof app
export type StorefrontModels = InferModelsMap<typeof app>
