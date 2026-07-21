import { closeDb, initDb } from '@epinfresh/database'
import { productWWWPlugin } from '@epinfresh/product'
import { closeRedis, initRedis } from '@epinfresh/session'
import {
  EnvValidationError,
  type InferModelsMap,
  isProduction,
  loadEnv,
  wwwEnvSchema,
} from '@epinfresh/shared'
import { userWWWPlugin } from '@epinfresh/user'
import { Elysia, ValidationError } from 'elysia'

let env: ReturnType<typeof loadEnv<typeof wwwEnvSchema>>
try {
  env = loadEnv(wwwEnvSchema)
} catch (e) {
  if (e instanceof EnvValidationError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}

initDb(env.DATABASE_URL)
initRedis(env.REDIS_URL)

const port = Number(env.WWW_PORT)

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
  .get('/health', () => ({ status: 'ok', service: 'www' }))
  .use(userWWWPlugin)
  .use(productWWWPlugin)
  .listen(port)

console.log(`🦊 WWW API running at http://localhost:${port}`)

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
export type WWWModels = InferModelsMap<typeof app>
