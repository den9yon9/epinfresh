import {
  type RateLimitPluginOptions,
  type RateLimitStore,
  type RedisClientLike,
  rateLimit as nazliRateLimit,
} from 'elysia-nazli'
import { redisStore } from 'elysia-nazli/redis'
import { getRedis } from './redis'

export interface AuthRateLimitOptions {
  limit?: number
  window?: RateLimitPluginOptions['window']
  prefix?: string
  namespace?: string
}

function lazyRedisStore(prefix: string): RateLimitStore {
  let real: RateLimitStore | undefined
  const ensure = (): RateLimitStore => {
    if (!real) {
      real = redisStore({
        client: getRedis() as unknown as RedisClientLike,
        adapter: 'ioredis',
        prefix,
      })
    }
    return real
  }
  return {
    hit: (input) => ensure().hit(input),
    cleanup: (now) => {
      ensure().cleanup?.(now)
    },
    close: () => {
      ensure().close?.()
    },
  } satisfies RateLimitStore
}

export function authRateLimit(opts: AuthRateLimitOptions = {}): ReturnType<typeof nazliRateLimit> {
  return nazliRateLimit({
    namespace: opts.namespace ?? 'epinfresh',
    store: lazyRedisStore(opts.prefix ?? 'rl'),
    trustProxy: true,
    limit: opts.limit ?? 120,
    window: opts.window ?? '1m',
    headers: { standard: true, legacy: false },
    onLimit: () =>
      new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json;charset=utf-8' },
      }),
  })
}
