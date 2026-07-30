import { Elysia, status } from 'elysia'
import { commonModel } from './commonModel'
import { mapDbError } from './dbError'
import { logger } from './logger'
import { requestLogger } from './requestLogger'
import { securityHeaders } from './securityHeaders'

interface CreateApiServerOptions {
  serviceName: string
  port: number
  initResources: () => void
  closeResources: () => Promise<void>
  healthCheck: () => Promise<{ db: boolean; redis: boolean }>
  // biome-ignore lint/suspicious/noExplicitAny: Elysia generic types diverge per .use() chain
  setup: (app: any) => any
}

export function createApiServer(options: CreateApiServerOptions) {
  const { serviceName, port, initResources, closeResources, healthCheck, setup } = options

  initResources()

  const app = new Elysia()
    .use(requestLogger())
    .use(securityHeaders())
    .onError(({ error }) => {
      const mapped = mapDbError(error)
      if (mapped) return status(mapped.status, mapped.body)
    })
    .use(commonModel)
    .get('/health', async ({ set }) => {
      const { db: dbOk, redis: redisOk } = await healthCheck()
      const healthy = dbOk && redisOk
      set.status = healthy ? 200 : 503
      return { status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk }
    })

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
      await closeResources()
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
