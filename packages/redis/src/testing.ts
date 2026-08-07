import { createRedisClient } from './index'

export async function flushTestRedis(
  url: string = process.env.REDIS_URL ?? 'redis://localhost:6379/1',
): Promise<void> {
  const redis = createRedisClient(url)
  try {
    await redis.flushdb()
  } finally {
    await redis.quit()
  }
}
