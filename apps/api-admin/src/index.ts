import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, db, initDb } from '@epinfresh/database'
import { productAdminPlugin } from '@epinfresh/product'
import { authRateLimit, closeRedis, getRedis, initRedis } from '@epinfresh/session'
import {
  type InferModelsMap,
  commonModel,
  loadEnv,
  logger,
  mapDbError,
  requestLogger,
  securityHeaders,
} from '@epinfresh/shared'
import { userAdminPlugin } from '@epinfresh/user'
import { Elysia, status } from 'elysia'
import { adminEnvSchema } from './env'

const env = loadEnv(adminEnvSchema)

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.ADMIN_PORT)
const enableDocs = env.NODE_ENV !== 'production'

const app = new Elysia()
  .use(requestLogger())
  .use(securityHeaders())
  .onError(({ error }) => {
    const mapped = mapDbError(error)
    if (mapped) return status(mapped.status, mapped.body)
  })
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
  .use(commonModel)
  .use(authRateLimit({ prefix: 'rl:admin' }))
  .get('/health', async ({ set }) => {
    let dbOk = false
    let redisOk = false
    try {
      await db.$primary`SELECT 1`
      dbOk = true
    } catch {}
    try {
      await getRedis().ping()
      redisOk = true
    } catch {}
    const healthy = dbOk && redisOk
    set.status = healthy ? 200 : 503
    return { status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk }
  })
  .use(userAdminPlugin)
  .use(productAdminPlugin)
  .listen(port)

logger.info({ port, service: 'admin' }, 'API listening')

const SHUTDOWN_TIMEOUT_MS = 10_000

async function shutdown() {
  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()
  try {
    await app.stop()
    await closeDb()
    await closeRedis()
  } catch (err) {
    logger.error({ err }, 'shutdown error')
    process.exit(1)
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
