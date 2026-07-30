import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, getSql, initDb } from '@epinfresh/database'
import { closeRedis, getRedis, initRedis } from '@epinfresh/redis'
import { authRateLimit } from '@epinfresh/session'
import { type InferModelsMap, createApiServer, loadEnv } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { adminEnvSchema } from './env'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

const env = loadEnv(adminEnvSchema)

const app = createApiServer({
  serviceName: 'admin',
  port: Number(env.ADMIN_PORT),
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
  setup: (app) => {
    const enableDocs = env.NODE_ENV !== 'production'
    return app
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
      .use(authRateLimit({ prefix: 'rl:admin' }))
      .use(userRoutes)
      .use(productRoutes)
  },
})

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
