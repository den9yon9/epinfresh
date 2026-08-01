import { registerEmailWorker } from '@epinfresh/queue'
import { baseEnvSchema, createLogger, parseEnv } from '@epinfresh/shared'

const env = parseEnv(baseEnvSchema)
const logger = createLogger(env.LOG_LEVEL)

logger.info('Worker application starting...')

const emailWorker = registerEmailWorker(env.REDIS_URL, logger)

async function shutdown() {
  logger.info('Shutting down worker...')
  try {
    await emailWorker.close()
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown')
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
