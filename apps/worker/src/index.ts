import { registerEmailWorker } from '@epinfresh/queue'
import { closeRedis, initRedis } from '@epinfresh/session'
import { baseEnvSchema, loadEnv, logger } from '@epinfresh/shared'

const env = loadEnv(baseEnvSchema)

initRedis(env.REDIS_URL)

logger.info('Worker application starting...')

const emailWorker = registerEmailWorker()

async function shutdown() {
  logger.info('Shutting down worker...')
  try {
    await emailWorker.close()
    await closeRedis()
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown')
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
