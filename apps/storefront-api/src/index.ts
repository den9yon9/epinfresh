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
import { type Queue } from '@epinfresh/queue'
import { type Redis } from '@epinfresh/redis'
import { type Logger } from '@epinfresh/shared'
import { type SendEmailJobData } from '@epinfresh/user/jobs'
import { Elysia } from 'elysia'

import { createStorefrontDeps } from './deps'
import { createEnv } from './env'
import { createPlugins } from './plugins'
import { createOrderRoutes } from './routes/order'
import { createProductRoutes } from './routes/product'
import { createUserRoutes } from './routes/user'

export interface StorefrontAppOptions {
  db: Db
  redis: Redis
  emailQueue: Queue<SendEmailJobData>
  sessionSecret: string
  corsOrigin: true | string | string[]
  trustProxy: boolean
  isProduction: boolean
  logger: Logger
}

export function buildApp(options: StorefrontAppOptions) {
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
              info: { title: 'Epinfresh Storefront API', version: '1.0.0' },
            },
          })
        : new Elysia(),
    )
    .use(plugins.emailQueuePlugin)
    .use(createUserRoutes(plugins))
    .use(createProductRoutes(plugins))
    .use(createOrderRoutes(plugins))
    .get('/health', ({ db, redis }) => healthCheck({ db, redis }))
}

if (import.meta.main) {
  const env = createEnv()
  const deps = createStorefrontDeps(env)
  startServer(buildApp(deps), {
    serviceName: 'storefront',
    port: Number(env.STOREFRONT_PORT),
    logger: deps.logger,
  })
}

export type App = ReturnType<typeof buildApp>
