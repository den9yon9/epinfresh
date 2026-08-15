import { createLogger } from '@epinfresh/shared'

import { createEnv } from './env'
import { registerWorkers } from './registry'

const env = createEnv()
const logger = createLogger(env.LOG_LEVEL)

logger.info('Worker application starting...')

const { workers, close } = registerWorkers(env, logger)

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down worker...')
  const results = await Promise.allSettled(workers.map((worker) => worker.close()))
  await close()
  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    logger.error({ count: failed.length }, 'Errors during worker shutdown')
    process.exit(1)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
