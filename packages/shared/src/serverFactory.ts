import { type AnyElysia, Elysia, status } from 'elysia'
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
}

// `App` 用 AnyElysia 约束: setup 返回的完整装饰链(redis/db/session + 所有路由)
// 无法赋给裸 `Elysia`(Elysia 类型参数逆变),any 参数才能接住完整链。
export function createApiServer<App extends AnyElysia>(
  options: CreateApiServerOptions & {
    setup: (app: Elysia) => App
  },
): App {
  const { serviceName, port, logger, isProduction, setup } = options

  const base = new Elysia()
    .use(requestLogger(logger))
    .use(securityHeaders(isProduction))
    .onError(({ error }) => {
      const mapped = mapDbError(error)
      if (mapped) return status(mapped.status, mapped.body)
    })
    .use(commonModel)

  // ponytail: base 的 model/hook 类型无法赋给 setup 的普通 `Elysia` 参数
  // (Elysia 类型参数逆变);setup 里重挂插件把 decorator/route 类型累积回 `App`。
  const app = setup(base as unknown as Elysia)

  app.get('/health', async (ctx) => {
    const { redis, db, set } = ctx as unknown as {
      redis: { ping: () => Promise<unknown> }
      db: { execute: (sql: string) => Promise<unknown> }
      set: { status: number }
    }
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
  })

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

  return app
}
