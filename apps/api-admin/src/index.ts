import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { createDb, dbPlugin } from '@epinfresh/database'
import { createRedisClient, redisPlugin } from '@epinfresh/redis'
import { authRateLimit } from '@epinfresh/session'
import { type InferModelsMap, createApiServer, createLogger } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { env } from './env'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const logger = createLogger(env.LOG_LEVEL)
const isProduction = env.NODE_ENV === 'production'

const redis = createRedisClient(env.REDIS_URL)
const db = createDb(env.DATABASE_URL)

const app = createApiServer({
  serviceName: 'admin',
  port: Number(env.ADMIN_PORT),
  logger,
  isProduction,
  setup: (app) => {
    const enableDocs = !isProduction
    return app
      .use(redisPlugin(redis, { logger }))
      .use(dbPlugin(db))
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
      .use(authRateLimit({ redis, prefix: 'rl:admin', trustProxy: env.TRUST_PROXY }))
      .use(
        userRoutes({
          db,
          redis,
          logger,
          sessionSecret: env.SESSION_SECRET,
          isProduction,
        }),
      )
      .use(
        productRoutes({
          db,
          redis,
          logger,
          sessionSecret: env.SESSION_SECRET,
          isProduction,
        }),
      )
  },
})

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
