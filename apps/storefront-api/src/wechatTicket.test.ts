import { describe, expect, test } from 'bun:test'

import { createTicketCache } from './wechatTicket'

describe('createTicketCache', () => {
  test('serves concurrent misses with a single load', async () => {
    let loads = 0
    let release: (value: string) => void = () => {}
    const pending = new Promise<string>((resolve) => {
      release = resolve
    })
    const cache = createTicketCache({
      ttlMs: 1000,
      load: async () => {
        loads += 1
        return pending
      },
    })

    const first = cache.get()
    const second = cache.get()
    release('ticket-1')
    expect(await Promise.all([first, second])).toEqual(['ticket-1', 'ticket-1'])
    expect(loads).toBe(1)
  })

  test('returns the cached value until the ttl expires', async () => {
    let now = 0
    let loads = 0
    const cache = createTicketCache({
      ttlMs: 1000,
      load: async () => `ticket-${++loads}`,
      now: () => now,
    })

    expect(await cache.get()).toBe('ticket-1')
    expect(await cache.get()).toBe('ticket-1')
    now = 1001
    expect(await cache.get()).toBe('ticket-2')
    expect(loads).toBe(2)
  })

  test('does not cache failures and retries on the next get', async () => {
    let loads = 0
    const cache = createTicketCache({
      ttlMs: 1000,
      load: async () => {
        loads += 1
        if (loads === 1) throw new Error('upstream down')
        return 'ticket-ok'
      },
    })

    await expect(cache.get()).rejects.toThrow('upstream down')
    expect(await cache.get()).toBe('ticket-ok')
    expect(loads).toBe(2)
  })

  test('invalidate forces the next load to refresh', async () => {
    let loads = 0
    const cache = createTicketCache({
      ttlMs: 1000,
      load: async () => `ticket-${++loads}`,
    })

    expect(await cache.get()).toBe('ticket-1')
    cache.invalidate()
    expect(await cache.get()).toBe('ticket-2')
  })
})
