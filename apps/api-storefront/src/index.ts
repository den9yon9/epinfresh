import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { createDb, dbPlugin } from '@epinfresh/database'
import { getEmailQueue } from '@epinfresh/queue'
import { createRedisClient, redisPlugin } from '@epinfresh/redis'
import { type InferModelsMap, createApiServer, createLogger } from '@epinfresh/shared'
import { env } from './env'
import { checkoutRoutes } from './routes/checkout'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const logger = createLogger(env.LOG_LEVEL)
const isProduction = env.NODE_ENV === 'production'

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)
const emailQueue = getEmailQueue(env.REDIS_URL)

const app = createApiServer({
  serviceName: 'storefront',
  port: Number(env.STOREFRONT_PORT),
  logger,
  isProduction,
  plugins: [redisPlugin(redis, { logger }), dbPlugin(db)],
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
      .use(
        userRoutes({
          db,
          redis,
          emailQueue,
          logger,
          sessionSecret: env.SESSION_SECRET,
          isProduction,
          trustProxy: env.TRUST_PROXY,
        }),
      )
      .use(productRoutes({ db }))
      .use(
        checkoutRoutes({
          db,
          redis,
          logger,
          sessionSecret: env.SESSION_SECRET,
          isProduction,
        }),
      ),
})

export type App = typeof app
export type StorefrontModels = InferModelsMap<typeof app>
