import type { Redis } from '@epinfresh/redis'
import {
  rateLimit as nazliRateLimit,
  type RateLimitPluginOptions,
  type RedisClientLike,
} from 'elysia-nazli'
import { redisStore } from 'elysia-nazli/redis'

export interface AuthRateLimitOptions {
  redis: Redis
  limit?: number
  window?: RateLimitPluginOptions['window']
  prefix?: string
  namespace?: string
  trustProxy?: boolean
}

export function authRateLimit(opts: AuthRateLimitOptions): ReturnType<typeof nazliRateLimit> {
  const trustProxy = opts.trustProxy ?? false
  return nazliRateLimit({
    namespace: opts.namespace ?? 'epinfresh',
    store: redisStore({
      client: opts.redis as unknown as RedisClientLike,
      adapter: 'ioredis',
      prefix: opts.prefix ?? 'rl',
    }),
    trustProxy,
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
