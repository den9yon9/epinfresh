import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { type Db } from '@epinfresh/database'
import {
  commonModel,
  healthCheck,
  requestLogger,
  securityHeaders,
  startServer,
} from '@epinfresh/http'
import { type Redis } from '@epinfresh/redis'
import { type Logger } from '@epinfresh/shared'
import { Elysia } from 'elysia'

import { createAdminDeps } from './deps'
import { createEnv } from './env'
import { createPlugins } from './plugins'
import { createAuthRoutes } from './routes/auth'
import { createOrderRoutes } from './routes/order'
import { createProductRoutes } from './routes/product'
import { createUserRoutes } from './routes/user'

export interface AdminAppOptions {
  db: Db
  redis: Redis
  sessionSecret: string
  corsOrigin: true | string | string[]
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

export function buildApp(options: AdminAppOptions) {
  const plugins = createPlugins(options)
  const enableDocs = !options.isProduction
  return new Elysia()
    .use(requestLogger(options.logger))
    .use(securityHeaders(options.isProduction))
    .use(commonModel)
    .use(plugins.redisPlugin)
    .use(plugins.dbPlugin)
    .use(cors({ origin: options.corsOrigin, credentials: true }))
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
    .use(plugins.rateLimitPlugin)
    .use(createAuthRoutes(plugins))
    .use(createUserRoutes(plugins))
    .use(createProductRoutes(plugins))
    .use(createOrderRoutes(plugins))
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
}

if (import.meta.main) {
  const env = createEnv()
  const deps = createAdminDeps(env)
  startServer(buildApp(deps), {
    serviceName: 'admin',
    port: Number(env.ADMIN_PORT),
    logger: deps.logger,
  })
}

export type App = ReturnType<typeof buildApp>
