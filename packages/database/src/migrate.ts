import { baseEnvSchema, createLogger, parseEnv } from '@epinfresh/shared'
import { runMigrations } from './index'

const env = parseEnv(baseEnvSchema)
const logger = createLogger(env.LOG_LEVEL)

try {
  await runMigrations(env.DATABASE_URL)
  logger.info('migrations applied')
} catch (err) {
  logger.error({ err }, 'migration failed')
  process.exit(1)
}
