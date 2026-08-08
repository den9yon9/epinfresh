import { type Redis } from '@epinfresh/redis'
import type { Logger } from '@epinfresh/shared'
import { Elysia } from 'elysia'

export function redisPlugin(client: Redis, opts: { logger: Logger }) {
  const { logger } = opts
  client.on('error', (err) => {
    logger.error({ err }, 'redis connection error')
  })
  return new Elysia({ name: 'infra-redis' })
    .decorate('redis', client)
    .onStart(async () => {
      if (client.status !== 'wait') return
      try {
        await client.connect()
      } catch (err) {
        logger.error({ err }, 'redis initial connect failed; retrying in background')
      }
    })
    .onStop(async () => {
      await client.quit()
    })
}
