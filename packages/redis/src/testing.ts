import { getTestEnv } from '@epinfresh/shared/testing'

import { createRedisClient } from './index'

export async function flushTestRedis(url: string = getTestEnv().TESTING_REDIS_URL): Promise<void> {
  const redis = createRedisClient(url)
  try {
    // lazyConnect + enableOfflineQueue: false 下必须先手动 connect
    await redis.connect()
    await redis.flushdb()
  } finally {
    await redis.quit()
  }
}
