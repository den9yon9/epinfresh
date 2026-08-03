import { type Redis, type RedisOptions, createRedisClient } from '@epinfresh/redis'
import type { Logger } from '@epinfresh/shared'
import { Elysia } from 'elysia'

export function redisPlugin(connection: string | Redis, opts: RedisOptions & { logger: Logger }) {
  const { logger, ...redisOpts } = opts
  const client =
    typeof connection === 'string' ? createRedisClient(connection, redisOpts) : connection
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
