import { getEnv, logger } from '@epinfresh/shared'
import { closeDb, initDb, runMigrations } from './index'

initDb(getEnv().DATABASE_URL)
try {
  await runMigrations()
  logger.info('migrations applied')
} finally {
  await closeDb()
}
