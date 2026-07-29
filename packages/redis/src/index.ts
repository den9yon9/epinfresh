import { logger } from '@epinfresh/shared'
import { Redis, type RedisOptions } from 'ioredis'

export type { Redis, RedisOptions }

let instance: Redis | null = null

export function setRedis(r: Redis): void {
  if (instance) instance.disconnect()
  instance = r
  r.on('error', (err) => {
    logger.error({ err }, 'redis connection error')
  })
}

export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
    ...opts,
  })
}

export function initRedis(url: string, opts: RedisOptions = {}): Redis {
  if (instance) {
    instance.disconnect()
  }
  instance = createRedis(url, opts)
  instance.on('error', (err) => {
    logger.error({ err }, 'redis connection error')
  })
  return instance
}

export function getRedis(): Redis {
  if (!instance) throw new Error('Redis not initialized. Call initRedis(env.REDIS_URL) first.')
  return instance
}

export async function closeRedis(): Promise<void> {
  if (instance) {
    await instance.quit()
    instance = null
  }
}
