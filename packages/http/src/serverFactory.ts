import type { Logger } from '@epinfresh/shared'
import type { AnyElysia } from 'elysia'

export interface StartServerOptions {
  port: number
  logger: Logger
  serviceName: string
}

export function startServer<App extends AnyElysia>(app: App, options: StartServerOptions): void {
  const { port, logger, serviceName } = options
  app.listen(port)
  logger.info({ port, service: serviceName }, 'API listening')

  const SHUTDOWN_TIMEOUT_MS = 10_000

  async function shutdown() {
    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()
    try {
      await app.stop()
    } catch (err) {
      logger.error({ err }, 'shutdown error')
      process.exit(1)
    }
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

export interface HealthCheckDeps {
  db: { execute: (sql: string) => Promise<unknown> }
  redis: { ping: () => Promise<unknown> }
  set: { status?: number | string }
}

export async function healthCheck({ db, redis, set }: HealthCheckDeps) {
  let dbOk = false
  let redisOk = false
  try {
    await db.execute('SELECT 1')
    dbOk = true
  } catch {}
  try {
    await redis.ping()
    redisOk = true
  } catch {}
  const healthy = dbOk && redisOk
  set.status = healthy ? 200 : 503
  return { status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk }
}
