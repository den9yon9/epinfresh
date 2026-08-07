import { getTestEnv } from '@epinfresh/shared/testing'

import { createRedisClient } from './index'

export async function flushTestRedis(url: string = getTestEnv().TEST_REDIS_URL): Promise<void> {
  const redis = createRedisClient(url)
  try {
    await redis.flushdb()
  } finally {
    await redis.quit()
  }
}
