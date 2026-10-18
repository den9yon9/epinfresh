import { DEFAULT_LOCALE, type Locale, resolveLocale, translate } from '@epinfresh/i18n'
import type { Redis } from '@epinfresh/redis'
import { rateLimit as nazliRateLimit, type RedisClientLike } from 'elysia-nazli'
import { redisStore } from 'elysia-nazli/redis'

export interface AuthRateLimitOptions {
  redis: Redis
  prefix?: string
  namespace?: string
  trustProxy?: boolean
  // 无请求语言线索时的回退语言(来自 env DEFAULT_LOCALE)
  defaultLocale?: Locale
}

// ponytail: 不配置顶层 limit/window —— nazli 的顶层规则会生成全局 onRequest 计数,
// 一旦 .use() 到路由上会限制整个 API(曾导致商品/购物车接口被 429)。
// 限流只通过路由级 rateLimit 宏生效(login/forgot/reset/register 各自配置, scoped)
export function authRateLimit(opts: AuthRateLimitOptions): ReturnType<typeof nazliRateLimit> {
  const trustProxy = opts.trustProxy ?? false
  const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE
  return nazliRateLimit({
    namespace: opts.namespace ?? 'epinfresh',
    store: redisStore({
      client: opts.redis as unknown as RedisClientLike,
      adapter: 'ioredis',
      prefix: opts.prefix ?? 'rl',
    }),
    trustProxy,
    headers: { standard: true, legacy: false },
    // 限流在路由前短路(裸 Response, 不走 onAfterHandle 本地化), 故在此按请求语言取译文。
    onLimit: ({ context }) => {
      const locale = resolveLocale({
        override: context.request.headers.get('x-locale'),
        acceptLanguage: context.request.headers.get('accept-language'),
        fallback: defaultLocale,
      })
      return new Response(
        JSON.stringify({ error: 'RATE_LIMITED', message: translate(locale, 'Too many requests') }),
        {
          status: 429,
          headers: { 'content-type': 'application/json;charset=utf-8' },
        },
      )
    },
  })
}
