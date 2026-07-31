import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { createDb, dbPlugin } from '@epinfresh/database'
import { getEmailQueue } from '@epinfresh/queue'
import { createRedisClient, redisPlugin } from '@epinfresh/redis'
import { createSessionPlugin } from '@epinfresh/session'
import { type InferModelsMap, createApiServer, loadEnv } from '@epinfresh/shared'
import { storefrontEnvSchema } from './env'
import { checkoutRoutes } from './routes/checkout'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const env = loadEnv(storefrontEnvSchema)

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)
const emailQueue = getEmailQueue(env.REDIS_URL)

const app = createApiServer({
  serviceName: 'storefront',
  port: Number(env.STOREFRONT_PORT),
  plugins: [redisPlugin(redis), dbPlugin(db)],
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
      .use(userRoutes({ db, redis, emailQueue }))
      .use(productRoutes({ db }))
      .use(checkoutRoutes({ db, redis })),
})

export type App = typeof app
export type StorefrontModels = InferModelsMap<typeof app>
