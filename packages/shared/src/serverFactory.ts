import { Elysia, status } from 'elysia'
import { commonModel } from './commonModel'
import { mapDbError } from './dbError'
import type { Logger } from './logger'
import { requestLogger } from './requestLogger'
import { securityHeaders } from './securityHeaders'

interface CreateApiServerOptions {
  serviceName: string
  port: number
  logger: Logger
  isProduction: boolean
  // biome-ignore lint/suspicious/noExplicitAny: Elysia generic types diverge per .use() chain
  plugins: any[]
  // biome-ignore lint/suspicious/noExplicitAny: Elysia generic types diverge per .use() chain
  setup: (app: any) => any
}

export function createApiServer(options: CreateApiServerOptions) {
  const { serviceName, port, logger, isProduction, plugins, setup } = options

  // biome-ignore lint/suspicious/noExplicitAny: infra plugins contribute runtime context decorators
  let app: any = new Elysia()
    .use(requestLogger(logger))
    .use(securityHeaders(isProduction))
    .onError(({ error }) => {
      const mapped = mapDbError(error)
      if (mapped) return status(mapped.status, mapped.body)
    })
    .use(commonModel)

  for (const plugin of plugins) {
    app = app.use(plugin)
  }

  app = app.get(
    '/health',
    async (ctx: {
      redis: { ping: () => Promise<unknown> }
      db: { execute: (sql: string) => Promise<unknown> }
      set: { status: number }
    }) => {
      const { redis, db, set } = ctx
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
    },
  )

  const configured = setup(app) as Elysia
  configured.listen(port)

  logger.info({ port, service: serviceName }, 'API listening')

  const SHUTDOWN_TIMEOUT_MS = 10_000

  async function shutdown() {
    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()
    try {
      await configured.stop()
    } catch (err) {
      logger.error({ err }, 'shutdown error')
      process.exit(1)
    }
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return configured
}
