import type { Logger } from '@epinfresh/shared'
import { runWithRequestId } from '@epinfresh/shared'
import type { AnyElysia } from 'elysia'

export interface StartServerOptions {
  port: number
  logger: Logger
  serviceName: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ponytail: 只认 x-request-id; 网关若用别的名字(x-correlation-id 等), 加进这个数组即可
const REQUEST_ID_HEADERS = ['x-request-id']

function resolveRequestId(request: Request): string {
  for (const name of REQUEST_ID_HEADERS) {
    const incoming = request.headers.get(name)
    if (incoming && UUID_RE.test(incoming)) return incoming
  }
  return crypto.randomUUID()
}

export function startServer<App extends AnyElysia>(app: App, options: StartServerOptions): void {
  const { port, logger, serviceName } = options
  app.compile()
  app.server = Bun.serve({
    port,
    fetch: (request) => runWithRequestId(resolveRequestId(request), () => app.handle(request)),
  })
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
}

export async function healthCheck({ db, redis }: HealthCheckDeps): Promise<Response> {
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
  return Response.json(
    { status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk },
    { status: healthy ? 200 : 503 },
  )
}
