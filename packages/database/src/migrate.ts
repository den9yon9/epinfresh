import { getEnv, logger } from '@epinfresh/shared'
import { runMigrations } from './index'

try {
  await runMigrations(getEnv().DATABASE_URL)
  logger.info('migrations applied')
} catch (err) {
  logger.error({ err }, 'migration failed')
  process.exit(1)
}
