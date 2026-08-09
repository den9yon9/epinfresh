import type { Redis } from '@epinfresh/redis'
import { rateLimit as nazliRateLimit, type RedisClientLike } from 'elysia-nazli'
import { redisStore } from 'elysia-nazli/redis'

export interface AuthRateLimitOptions {
  redis: Redis
  prefix?: string
  namespace?: string
  trustProxy?: boolean
}

// ponytail: 不配置顶层 limit/window —— nazli 的顶层规则会生成全局 onRequest 计数,
// 一旦 .use() 到路由上会限制整个 API(曾导致商品/购物车接口被 429)。
// 限流只通过路由级 rateLimit 宏生效(login/forgot/reset/register 各自配置, scoped)
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
    headers: { standard: true, legacy: false },
    onLimit: () =>
      new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json;charset=utf-8' },
      }),
  })
}
