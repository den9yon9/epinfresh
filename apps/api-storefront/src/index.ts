import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, initDb } from '@epinfresh/database'
import { productStorefrontPlugin } from '@epinfresh/product'
import { closeRedis, initRedis } from '@epinfresh/session'
import {
  type InferModelsMap,
  commonModel,
  loadEnv,
  logger,
  mapDbError,
  requestLogger,
  securityHeaders,
} from '@epinfresh/shared'
import { userStorefrontPlugin } from '@epinfresh/user'

import { Elysia, status } from 'elysia'
import { storefrontEnvSchema } from './env'
const env = loadEnv(storefrontEnvSchema)

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.STOREFRONT_PORT)

const app = new Elysia()
  .use(requestLogger())
  .use(securityHeaders())
  .onError(({ error }) => {
    const mapped = mapDbError(error)
    if (mapped) return status(mapped.status, mapped.body)
  })
  .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  .use(
    openapi({
      path: '/docs',
      documentation: {
        info: { title: 'Epinfresh Storefront API', version: '1.0.0' },
      },
    }),
  )
  .use(commonModel)
  .get('/health', () => ({ status: 'ok', service: 'storefront' }))
  .use(userStorefrontPlugin)
  .use(productStorefrontPlugin)
  .listen(port)

logger.info({ port, service: 'storefront' }, 'API listening')

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
export type StorefrontModels = InferModelsMap<typeof app>
