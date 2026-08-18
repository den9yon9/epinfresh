import { type Redis } from '@epinfresh/redis'
import { createRedisClient } from '@epinfresh/redis'
import { flushTestRedis } from '@epinfresh/redis/testing'
import { getTestEnv } from '@epinfresh/shared/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createSessionStore } from './sessionPlugin'

const env = getTestEnv()

let redis: Redis

beforeAll(async () => {
  redis = createRedisClient(env.TESTING_REDIS_URL)
  await redis.connect()
})

afterAll(async () => {
  await redis.quit()
})

beforeEach(async () => {
  await flushTestRedis()
})

describe('createSessionStore', () => {
  test('create/destroy maintain the per-user session index', async () => {
    const store = createSessionStore(redis)
    const sessionId = await store.create({ userId: 'u-1', role: 'customer' })

    const members = await redis.smembers('session:user:u-1')
    expect(members).toEqual([sessionId])

    await store.destroy(sessionId)

    expect(await store.read(sessionId)).toBeNull()
    expect(await redis.smembers('session:user:u-1')).toEqual([])
  })

  test("destroyAllForUser removes all of a user's sessions without a full scan", async () => {
    const store = createSessionStore(redis)
    const s1 = await store.create({ userId: 'u-1', role: 'customer' })
    const s2 = await store.create({ userId: 'u-1', role: 'customer' })
    const other = await store.create({ userId: 'u-2', role: 'admin' })

    await store.destroyAllForUser('u-1')

    expect(await store.read(s1)).toBeNull()
    expect(await store.read(s2)).toBeNull()
    // 其他用户会话不受影响, 索引互不干扰
    expect(await store.read(other)).toEqual({ userId: 'u-2', role: 'admin' })
    expect(await redis.exists('session:user:u-1')).toBe(0)
  })

  test('destroyAllForUser is a no-op for a user without sessions', async () => {
    const store = createSessionStore(redis)
    await store.destroyAllForUser('ghost')
    expect(await redis.keys('session:user:*')).toEqual([])
  })
})
