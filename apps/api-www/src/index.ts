import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, initDb } from '@epinfresh/database'
import { productWWWPlugin } from '@epinfresh/product'
import { closeRedis, initRedis } from '@epinfresh/session'
import {
  type InferModelsMap,
  commonModel,
  loadEnv,
  logger,
  mapDbError,
  requestLogger,
  wwwEnvSchema,
} from '@epinfresh/shared'
import { userWWWPlugin } from '@epinfresh/user'
import { Elysia, status } from 'elysia'

const env = loadEnv(wwwEnvSchema)

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.WWW_PORT)

const app = new Elysia()
  .use(requestLogger())
  .onError(({ error }) => {
    const mapped = mapDbError(error)
    if (mapped) return status(mapped.status, mapped.body)
  })
  .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  .use(
    openapi({
      path: '/docs',
      documentation: {
        info: { title: 'Epinfresh WWW API', version: '1.0.0' },
      },
    }),
  )
  .use(commonModel)
  .get('/health', () => ({ status: 'ok', service: 'www' }))
  .use(userWWWPlugin)
  .use(productWWWPlugin)
  .listen(port)

logger.info({ port, service: 'www' }, 'API listening')

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
export type WWWModels = InferModelsMap<typeof app>
