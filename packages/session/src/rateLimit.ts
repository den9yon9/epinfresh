import { getRedis } from '@epinfresh/redis'
import { getEnv } from '@epinfresh/shared'
import {
  type RateLimitPluginOptions,
  type RedisClientLike,
  rateLimit as nazliRateLimit,
} from 'elysia-nazli'
import { redisStore } from 'elysia-nazli/redis'

export interface AuthRateLimitOptions {
  limit?: number
  window?: RateLimitPluginOptions['window']
  prefix?: string
  namespace?: string
  trustProxy?: boolean
}

export function authRateLimit(opts: AuthRateLimitOptions = {}): ReturnType<typeof nazliRateLimit> {
  const trustProxy = opts.trustProxy ?? getEnv().TRUST_PROXY
  return nazliRateLimit({
    namespace: opts.namespace ?? 'epinfresh',
    store: redisStore({
      client: getRedis() as unknown as RedisClientLike,
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
