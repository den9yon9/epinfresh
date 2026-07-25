import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { closeDb, initDb } from '@epinfresh/database'
import { productAdminPlugin } from '@epinfresh/product'
import { closeRedis, createSessionPlugin, initRedis } from '@epinfresh/session'
import {
  type InferModelsMap,
  adminEnvSchema,
  commonModel,
  loadEnv,
  mapDbError,
  requestLogger,
} from '@epinfresh/shared'
import { userAdminPlugin } from '@epinfresh/user'
import { Elysia, status } from 'elysia'

const env = loadEnv(adminEnvSchema)

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.ADMIN_PORT)
const enableDocs = env.NODE_ENV !== 'production'

const app = new Elysia()
  .use(requestLogger())
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
  .get('/health', () => ({ status: 'ok', service: 'admin' }))
  .use(createSessionPlugin())
  .onBeforeHandle(({ session }) => {
    if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
    if (session.role !== 'admin') return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
  })
  .use(userAdminPlugin)
  .use(productAdminPlugin)
  .listen(port)

console.log(`🛡️  Admin API running at http://localhost:${port}`)

const SHUTDOWN_TIMEOUT_MS = 10_000

async function shutdown() {
  const forceExit = setTimeout(() => {
    console.error('[shutdown] timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()
  try {
    await app.stop()
    await closeDb()
    await closeRedis()
  } catch (err) {
    console.error('[shutdown] error:', err)
    process.exit(1)
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
