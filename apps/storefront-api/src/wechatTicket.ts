export interface TicketCacheOptions<T> {
  ttlMs: number
  load: () => Promise<T>
  now?: () => number
}

export interface TicketCache<T> {
  get: () => Promise<T>
  invalidate: () => void
}

// 上游凭证(微信 access_token/jsapi_ticket)的 TTL 缓存: 并发未命中共享同一 in-flight Promise,
// 失败不落缓存(下次调用可重试)。
export function createTicketCache<T>({
  ttlMs,
  load,
  now = Date.now,
}: TicketCacheOptions<T>): TicketCache<T> {
  let cached: { value: T; expiresAt: number } | null = null
  let inflight: Promise<T> | null = null

  return {
    async get() {
      if (cached && cached.expiresAt > now()) return cached.value
      if (inflight) return inflight
      inflight = load()
        .then((value) => {
          cached = { value, expiresAt: now() + ttlMs }
          return value
        })
        .finally(() => {
          inflight = null
        })
      return inflight
    },
    invalidate() {
      cached = null
    },
  }
}
