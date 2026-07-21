import { closeDb, initDb } from '@epinfresh/database'
import { productAdminPlugin } from '@epinfresh/product'
import { type Session, closeRedis, createSessionPlugin, initRedis } from '@epinfresh/session'
import {
  EnvValidationError,
  type InferModelsMap,
  adminEnvSchema,
  isProduction,
  loadEnv,
} from '@epinfresh/shared'
import { userAdminPlugin } from '@epinfresh/user'
import { Elysia, ValidationError, status } from 'elysia'

let env: ReturnType<typeof loadEnv<typeof adminEnvSchema>>
try {
  env = loadEnv(adminEnvSchema)
} catch (e) {
  if (e instanceof EnvValidationError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.ADMIN_PORT)

const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ValidationError) {
      set.status = 422
      return { error: 'VALIDATION', message: error.message }
    }
    if (isProduction()) {
      set.status = 500
      return { error: 'INTERNAL', message: 'Internal server error' }
    }
    set.status = 500
    return { error: 'INTERNAL', message: error instanceof Error ? error.message : 'unknown error' }
  })
  .get('/health', () => ({ status: 'ok', service: 'admin' }))
  .use(createSessionPlugin())
  .guard({
    as: 'scoped',
    // biome-ignore lint/suspicious/noExplicitAny: derive session type propagated cross-plugin
    beforeHandle: ({ session }: any) => {
      const s = session as Session | null
      if (!s) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
      if (s.role !== 'admin') return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
    },
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
