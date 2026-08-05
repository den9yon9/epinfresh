import { createLogger, parseEnv } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

import { runMigrations } from './index'

const env = parseEnv(
  Type.Object({
    DATABASE_URL: Type.String({ format: 'uri' }),
    LOG_LEVEL: Type.Union(
      [
        Type.Literal('debug'),
        Type.Literal('info'),
        Type.Literal('warn'),
        Type.Literal('error'),
        Type.Literal('silent'),
      ],
      { default: 'info' },
    ),
  }),
)
const logger = createLogger(env.LOG_LEVEL)

try {
  await runMigrations(env.DATABASE_URL)
  logger.info('migrations applied')
} catch (err) {
  logger.error({ err }, 'migration failed')
  process.exit(1)
}
