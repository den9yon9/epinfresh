import { logger } from '@epinfresh/shared'
import { createDb, runMigrations } from './index'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required. Set it via --env-file or shell.')
}

const db = createDb(url)
try {
  await runMigrations(db)
  logger.info('migrations applied')
} finally {
  await db.$primary.end({ timeout: 5 })
}
