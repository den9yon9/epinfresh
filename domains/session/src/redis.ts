import { Redis, type RedisOptions } from 'ioredis'

export type { Redis, RedisOptions }

let instance: Redis | null = null

export interface CreateRedisOptions extends RedisOptions {
  keyPrefix?: string
}

export function createRedis(url: string, opts: CreateRedisOptions = {}): Redis {
  const { keyPrefix, ...rest } = opts
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
    ...rest,
  })
  client.on('error', (err) => {
    console.error('[redis] connection error:', err.message || err.code)
  })
  if (keyPrefix) {
    void keyPrefix
  }
  return client
}

export function initRedis(url: string, opts: CreateRedisOptions = {}): Redis {
  if (instance) return instance
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
