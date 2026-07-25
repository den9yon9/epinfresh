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
  requestLogger,
} from '@epinfresh/shared'
import { userAdminPlugin } from '@epinfresh/user'
import { Elysia, status } from 'elysia'

const env = loadEnv(adminEnvSchema)

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.ADMIN_PORT)

const app = new Elysia()
  .use(requestLogger())
  .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
  .use(
    openapi({
      path: '/docs',
      documentation: {
        info: { title: 'Epinfresh Admin API', version: '1.0.0' },
      },
    }),
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

async function shutdown() {
  try {
    await app.stop()
    await closeDb()
    await closeRedis()
  } catch (err) {
    console.error('[shutdown] error:', err)
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export type App = typeof app
export type AdminModels = InferModelsMap<typeof app>
