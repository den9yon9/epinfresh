import { Redis, type RedisOptions } from 'ioredis'

export type { Redis, RedisOptions }

let instance: Redis | null = null
let cachedRedisUrl: string | null = null

export interface CreateRedisOptions extends RedisOptions {}

export function createRedis(url: string, opts: CreateRedisOptions = {}): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
    ...opts,
  })
  client.on('error', (err) => {
    console.error('[redis] connection error:', err.message)
  })
  return client
}

export function initRedis(url: string, opts: CreateRedisOptions = {}): Redis {
  if (instance) {
    if (cachedRedisUrl !== url) {
      throw new Error(
        `initRedis called with different URL; already initialized with ${cachedRedisUrl}`,
      )
    }
    return instance
  }
  cachedRedisUrl = url
  instance = createRedis(url, opts)
  return instance
}

export async function closeRedis(): Promise<void> {
  if (instance) {
    await instance.quit()
    instance = null
  }
}

export function getRedis(): Redis {
  if (!instance) throw new Error('Redis not initialized. Call initRedis(env.REDIS_URL) first.')
  return instance
}
