import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import type { LogisticsProvider } from '@epinfresh/logistics'
import { createMockLogisticsProvider } from '@epinfresh/logistics'
import { err, ok } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { pollAndSyncShippedOrders } from './service'

let db: Db

beforeAll(async () => {
  db = await prepareTestDb()
})

afterAll(async () => {
  if (db) await closeDb(db)
})

beforeEach(async () => {
  await resetDb(db)
})

async function seedUser(email = 'alice@example.com') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email, passwordHash: 'not-a-real-hash' })
    .returning()
  return user
}

async function seedShippedOrder(email = 'alice@example.com', slug = 'apple') {
  const user = await seedUser(email)
  const [product] = await db
    .insert(schema.products)
    .values({ name: 'Apple', slug, status: 'published' })
    .returning()
  await db.insert(schema.productSkus).values({
    productId: product.id,
    name: '1kg',
    skuCode: `${slug.toUpperCase()}-1KG`,
    price: '5.00',
    stock: 10,
  })
  const [address] = await db
    .insert(schema.addresses)
    .values({
      userId: user.id,
      recipientName: 'Alice',
      phone: '138',
      province: 'Shanghai',
      city: 'Shanghai',
      detail: 'Downtown',
    })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status: 'paid', totalAmount: '5.00', addressId: address.id })
    .returning()
  const shippedAt = new Date(Date.now() - 60 * 60 * 1000)
  const trackingNumber = `SF-${email.split('@')[0].toUpperCase()}`
  const [shipped] = await db
    .update(schema.orders)
    .set({
      status: 'shipped',
      courierCompany: 'sf',
      trackingNumber,
      shippedAt,
    })
    .where(eq(schema.orders.id, order.id))
    .returning()
  return shipped
}

function providerFromSnapshots(
  snapshots: Record<string, { delivered: boolean; status: 'delivered' | 'in_transit' }>,
): LogisticsProvider {
  return {
    async queryTrack(input) {
      const snap = snapshots[input.trackingNumber]
      if (!snap) return err('PROVIDER_ERROR')
      return ok({
        events: [{ time: new Date().toISOString(), status: snap.status, desc: 'x' }],
        status: snap.status,
        delivered: snap.delivered,
        deliveredAt: snap.delivered ? new Date().toISOString() : null,
      })
    },
  }
}

describe('pollAndSyncShippedOrders', () => {
  test('delivered snapshot completes the order and persists the track', async () => {
    const order = await seedShippedOrder()
    const provider = providerFromSnapshots({ 'SF-ALICE': { delivered: true, status: 'delivered' } })

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary).toEqual({
      polled: 1,
      delivered: 1,
      autoCompleted: 1,
      failed: 0,
      exceptions: 0,
      staleNotDelivered: 0,
    })

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(row.status).toBe('completed')
    expect(row.completedAt).not.toBeNull()
    const [track] = await db
      .select()
      .from(schema.logisticsTracks)
      .where(eq(schema.logisticsTracks.orderId, order.id))
    expect(track.company).toBe('sf')
    expect(track.status).toBe('delivered')
    expect(track.deliveredAt).not.toBeNull()
  })

  test('in-transit snapshot updates the track but leaves the order shipped', async () => {
    const order = await seedShippedOrder()
    const provider = providerFromSnapshots({
      'SF-ALICE': { delivered: false, status: 'in_transit' },
    })

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary).toEqual({
      polled: 1,
      delivered: 0,
      autoCompleted: 0,
      failed: 0,
      exceptions: 0,
      staleNotDelivered: 0,
    })

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(row.status).toBe('shipped')
  })

  test('provider failure skips the order without breaking the batch', async () => {
    const broken = await seedShippedOrder('a@example.com', 'apple-a')
    const healthy = await seedShippedOrder('b@example.com', 'apple-b')
    const provider: LogisticsProvider = {
      async queryTrack(input) {
        // 以 trackingNumber 区分单: A 失败, B 成功(验证失败不拖垮整批)
        if (input.trackingNumber === 'SF-A') return err('PROVIDER_ERROR')
        return ok({
          events: [{ time: new Date().toISOString(), status: 'delivered', desc: 'x' }],
          status: 'delivered',
          delivered: true,
          deliveredAt: new Date().toISOString(),
        })
      },
    }

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary.polled).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.autoCompleted).toBe(1)

    const [brokenRow] = await db.select().from(schema.orders).where(eq(schema.orders.id, broken.id))
    expect(brokenRow.status).toBe('shipped')
    const [healthyRow] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, healthy.id))
    expect(healthyRow.status).toBe('completed')
  })

  test('ignores shipped orders without courier company (manual confirm path)', async () => {
    const order = await seedShippedOrder()
    await db
      .update(schema.orders)
      .set({ courierCompany: null })
      .where(eq(schema.orders.id, order.id))
    const provider = createMockLogisticsProvider(0)

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary).toEqual({
      polled: 0,
      delivered: 0,
      autoCompleted: 0,
      failed: 0,
      exceptions: 0,
      staleNotDelivered: 0,
    })
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(row.status).toBe('shipped')
  })

  test('rejected snapshot counts as exception and never completes the order', async () => {
    const order = await seedShippedOrder()
    const provider: LogisticsProvider = {
      async queryTrack() {
        return ok({
          events: [
            { time: new Date().toISOString(), status: 'out_for_delivery', desc: '派送中' },
            { time: new Date().toISOString(), status: 'rejected', desc: '客户拒收' },
          ],
          status: 'rejected',
          delivered: false,
          deliveredAt: null,
        })
      },
    }

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary.exceptions).toBe(1)
    expect(summary.autoCompleted).toBe(0)

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    // 关键语义: 拒收单绝不能被"完成"
    expect(row.status).toBe('shipped')
    const [track] = await db
      .select()
      .from(schema.logisticsTracks)
      .where(eq(schema.logisticsTracks.orderId, order.id))
    expect(track.status).toBe('rejected')
  })

  test('stale not-delivered shipments are counted for alerting', async () => {
    // seedShippedOrder 的 shipped_at 已拨回 1 小时前——构造超 5 天的:
    const order = await seedShippedOrder()
    await db
      .update(schema.orders)
      .set({ shippedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.orders.id, order.id))
    const provider = providerFromSnapshots({
      'SF-ALICE': { delivered: false, status: 'in_transit' },
    })

    const summary = await pollAndSyncShippedOrders(db, provider)
    expect(summary.staleNotDelivered).toBe(1)
    expect(summary.autoCompleted).toBe(0)
  })
})
