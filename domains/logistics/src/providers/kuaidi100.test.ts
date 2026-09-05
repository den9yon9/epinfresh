import { describe, expect, test } from 'bun:test'

import { createLogisticsProviderFromEnv } from '../env'
import {
  createKuaidi100LogisticsProvider,
  type FetchLike,
  mapKuaidi100State,
  signKuaidi100,
  toKuaidi100Company,
} from './kuaidi100'

const DUMMY_CONFIG = {
  customer: 'TEST_CUSTOMER_123',
  key: 'TEST_KEY_SECRET',
  apiBase: 'http://localhost:9999/poll/query.do',
}

describe('kuaidi100 utilities', () => {
  test('signKuaidi100 generates uppercase MD5 signature', () => {
    const sign = signKuaidi100('{"com":"shunfeng"}', 'mykey', 'mycustomer')
    expect(sign).toMatch(/^[0-9A-F]{32}$/)
  })

  test('toKuaidi100Company maps supported carrier companies', () => {
    expect(toKuaidi100Company('sf')).toBe('shunfeng')
    expect(toKuaidi100Company('zto')).toBe('zhongtong')
    expect(toKuaidi100Company('yto')).toBe('yuantong')
    expect(toKuaidi100Company('jd')).toBe('jd')
    expect(toKuaidi100Company('ems')).toBe('ems')
    expect(toKuaidi100Company('unknown_carrier')).toBe('unknown_carrier')
  })

  test('mapKuaidi100State maps states properly', () => {
    expect(mapKuaidi100State('1')).toBe('collected')
    expect(mapKuaidi100State('0')).toBe('in_transit')
    expect(mapKuaidi100State('5')).toBe('out_for_delivery')
    expect(mapKuaidi100State('3')).toBe('delivered')
    expect(mapKuaidi100State('2')).toBe('delivery_failed')
    expect(mapKuaidi100State('4')).toBe('rejected')
    expect(mapKuaidi100State('14')).toBe('rejected')
  })
})

describe('createKuaidi100LogisticsProvider', () => {
  test('successfully queries and parses delivered tracking data', async () => {
    let capturedBody = ''
    const mockFetch: FetchLike = async (_url, init) => {
      capturedBody = String(init?.body ?? '')
      return new Response(
        JSON.stringify({
          status: '200',
          state: '3',
          message: 'ok',
          data: [
            {
              time: '2026-09-05 14:00:00',
              context: '客户已签收，感谢使用顺丰速运',
            },
            {
              time: '2026-09-05 09:00:00',
              context: '快件正在派送中',
            },
            {
              time: '2026-09-04 18:00:00',
              context: '顺丰速运 已收取快件',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const provider = createKuaidi100LogisticsProvider({
      ...DUMMY_CONFIG,
      fetchFn: mockFetch,
    })

    const result = await provider.queryTrack({
      company: 'sf',
      trackingNumber: 'SF1234567890',
      shippedAt: new Date('2026-09-04T10:00:00Z'),
      now: new Date('2026-09-05T15:00:00Z'),
    })

    expect(result.isOk()).toBe(true)
    const snapshot = result._unsafeUnwrap()
    expect(snapshot.status).toBe('delivered')
    expect(snapshot.delivered).toBe(true)
    expect(snapshot.deliveredAt).not.toBeNull()
    // 事件升序排布
    expect(snapshot.events).toHaveLength(3)
    expect(snapshot.events[0].status).toBe('collected')
    expect(snapshot.events[1].status).toBe('out_for_delivery')
    expect(snapshot.events[2].status).toBe('delivered')

    // 校验请求体包含 customer, param 和 sign
    expect(capturedBody).toContain('customer=TEST_CUSTOMER_123')
    expect(capturedBody).toContain('sign=')
    expect(capturedBody).toContain('shunfeng')
  })

  test('parses rejected delivery status', async () => {
    const mockFetch: FetchLike = async () => {
      return new Response(
        JSON.stringify({
          status: '200',
          state: '4',
          message: 'ok',
          data: [
            {
              time: '2026-09-05 14:00:00',
              context: '客户拒收，快件退回',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const provider = createKuaidi100LogisticsProvider({
      ...DUMMY_CONFIG,
      fetchFn: mockFetch,
    })

    const result = await provider.queryTrack({
      company: 'zto',
      trackingNumber: 'ZTO987654',
      shippedAt: new Date('2026-09-04T10:00:00Z'),
      now: new Date('2026-09-05T15:00:00Z'),
    })

    expect(result.isOk()).toBe(true)
    const snapshot = result._unsafeUnwrap()
    expect(snapshot.status).toBe('rejected')
    expect(snapshot.delivered).toBe(false)
    expect(snapshot.deliveredAt).toBeNull()
    expect(snapshot.events[0].status).toBe('rejected')
  })

  test('returns PROVIDER_ERROR on non-200 API response', async () => {
    const mockFetch: FetchLike = async () => {
      return new Response(
        JSON.stringify({
          status: '400',
          message: 'sign error',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const provider = createKuaidi100LogisticsProvider({
      ...DUMMY_CONFIG,
      fetchFn: mockFetch,
    })

    const result = await provider.queryTrack({
      company: 'sf',
      trackingNumber: 'SF000',
      shippedAt: new Date(),
      now: new Date(),
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PROVIDER_ERROR')
  })

  test('returns PROVIDER_ERROR on network fetch failure', async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error('network down')
    }

    const provider = createKuaidi100LogisticsProvider({
      ...DUMMY_CONFIG,
      fetchFn: mockFetch,
    })

    const result = await provider.queryTrack({
      company: 'sf',
      trackingNumber: 'SF000',
      shippedAt: new Date(),
      now: new Date(),
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PROVIDER_ERROR')
  })
})

describe('createLogisticsProviderFromEnv', () => {
  test('throws if kuaidi100 is selected but credentials missing', () => {
    expect(() =>
      createLogisticsProviderFromEnv({
        LOGISTICS_PROVIDER: 'kuaidi100',
      }),
    ).toThrow('KUAIDI100_CUSTOMER and KUAIDI100_KEY are required')
  })

  test('creates provider when kuaidi100 credentials provided', () => {
    const provider = createLogisticsProviderFromEnv({
      LOGISTICS_PROVIDER: 'kuaidi100',
      KUAIDI100_CUSTOMER: 'my_cust',
      KUAIDI100_KEY: 'my_key',
    })
    expect(provider).toBeDefined()
    expect(typeof provider.queryTrack).toBe('function')
  })
})
