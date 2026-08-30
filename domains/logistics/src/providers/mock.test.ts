import { describe, expect, test } from 'bun:test'

import { createMockLogisticsProvider } from './mock'

const SHIPPED_AT = new Date('2026-08-30T08:00:00Z')
const COMPANY = 'sf'
const TRACKING = 'SF000111222'

describe('createMockLogisticsProvider', () => {
  test('advances events deterministically with elapsed time', async () => {
    const provider = createMockLogisticsProvider(180 * 60 * 1000)

    // 刚发货: 只有揽收
    const at0 = await provider.queryTrack({
      company: COMPANY,
      trackingNumber: TRACKING,
      shippedAt: SHIPPED_AT,
      now: SHIPPED_AT,
    })
    expect(at0.isOk()).toBe(true)
    const snap0 = at0._unsafeUnwrap()
    expect(snap0.events).toHaveLength(1)
    expect(snap0.status).toBe('collected')
    expect(snap0.delivered).toBe(false)

    // 半程: 转运中
    const mid = await provider.queryTrack({
      company: COMPANY,
      trackingNumber: TRACKING,
      shippedAt: SHIPPED_AT,
      now: new Date(SHIPPED_AT.getTime() + 90 * 60 * 1000),
    })
    const snapMid = mid._unsafeUnwrap()
    expect(snapMid.events).toHaveLength(2)
    expect(snapMid.status).toBe('in_transit')
    expect(snapMid.delivered).toBe(false)

    // 窗口末: 签收
    const end = await provider.queryTrack({
      company: COMPANY,
      trackingNumber: TRACKING,
      shippedAt: SHIPPED_AT,
      now: new Date(SHIPPED_AT.getTime() + 180 * 60 * 1000),
    })
    const snapEnd = end._unsafeUnwrap()
    expect(snapEnd.events).toHaveLength(4)
    expect(snapEnd.status).toBe('delivered')
    expect(snapEnd.delivered).toBe(true)
    expect(snapEnd.deliveredAt).not.toBeNull()
  })

  test('deliverAfterMs=0 means delivered immediately (e2e mode)', async () => {
    const provider = createMockLogisticsProvider(0)
    const snap = (
      await provider.queryTrack({
        company: COMPANY,
        trackingNumber: TRACKING,
        shippedAt: SHIPPED_AT,
        now: SHIPPED_AT,
      })
    )._unsafeUnwrap()
    expect(snap.delivered).toBe(true)
    expect(snap.events).toHaveLength(4)
  })

  test('embeds company and tracking number in event descriptions', async () => {
    const provider = createMockLogisticsProvider(0)
    const snap = (
      await provider.queryTrack({
        company: COMPANY,
        trackingNumber: TRACKING,
        shippedAt: SHIPPED_AT,
        now: SHIPPED_AT,
      })
    )._unsafeUnwrap()
    for (const event of snap.events) {
      expect(event.desc).toContain(COMPANY)
      expect(event.desc).toContain(TRACKING)
    }
  })
})
