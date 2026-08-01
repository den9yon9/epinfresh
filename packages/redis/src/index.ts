import type { Logger } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { Redis, type RedisOptions } from 'ioredis'

export type { Redis, RedisOptions }

export function createRedisClient(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: true,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
    ...opts,
  })
}

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
