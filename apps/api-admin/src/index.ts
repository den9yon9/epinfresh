import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  commonModel,
  healthCheck,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/http'
import { Elysia } from 'elysia'
import { env } from './env'
import { adminDb, adminRateLimit, adminRedis, isProduction, logger } from './plugins'
import { productRoutes } from './routes/product'
import { userRoutes } from './routes/user'

export function buildApp() {
  const enableDocs = !isProduction
  return new Elysia()
    .use(requestLogger(logger))
    .use(securityHeaders(isProduction))
    .use(commonModel)
    .use(adminRedis)
    .use(adminDb)
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
    .use(adminRateLimit)
    .use(userRoutes)
    .use(productRoutes)
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
}

if (import.meta.main) {
  startServer(buildApp(), {
    serviceName: 'admin',
    port: Number(env.ADMIN_PORT),
    logger,
  })
}

export type App = ReturnType<typeof buildApp>
