import { registerEmailWorker } from '@epinfresh/queue'
import { baseEnvSchema, loadEnv, logger } from '@epinfresh/shared'

const env = loadEnv(baseEnvSchema)

logger.info('Worker application starting...')

const emailWorker = registerEmailWorker(env.REDIS_URL)

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
