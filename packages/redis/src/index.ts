import { Redis } from 'ioredis'

export type { Redis }

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: true,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
  })
}
