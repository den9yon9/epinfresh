import { getEnv, logger } from '@epinfresh/shared'
import { createDb, runMigrations } from './index'

const url = getEnv().DATABASE_URL

const db = createDb(url)
try {
  await runMigrations(db)
  logger.info('migrations applied')
} finally {
  await db.$primary.end({ timeout: 5 })
}
