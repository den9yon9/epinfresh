import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  autoCompleteShippedOrders,
  completeOrder,
  createOrderRecord,
  getOrderById,
  getOrderForUser,
  getOrderStatusCounts,
  listOrders,
  listOrdersByUser,
  shipOrder,
  updateOrderStatus,
} from './service'

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

async function seedSku(name: string, slug: string, price = '5.00', stock = 10) {
  const [product] = await db
    .insert(schema.products)
    .values({ name, slug, status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({
      productId: product.id,
      name: '1kg',
      skuCode: `${slug.toUpperCase()}-1KG`,
      price,
      stock,
    })
    .returning()
  return { product, sku }
}

async function seedAddress(userId: string) {
  const [address] = await db
    .insert(schema.addresses)
    .values({ userId, recipientName: 'Alice', phone: '13800000000', address: 'Shanghai Pudong' })
    .returning()
  return address
}

async function seedOrder(userId: string, skuId: string, quantity = 1, unitPrice = '5.00') {
  const address = await seedAddress(userId)
  return createOrderRecord(
    userId,
    [{ skuId, productName: 'Apple', skuName: '1kg', unitPrice, quantity }],
    {
      addressId: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      address: address.address,
    },
    db,
  )
}

describe('createOrderRecord', () => {
  test('persists order with computed total and snapshot lines', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const address = await seedAddress(user.id)

    const order = await createOrderRecord(
      user.id,
      [
        { skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity: 2 },
        { skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '3.50', quantity: 1 },
      ],
      {
        addressId: address.id,
        recipientName: address.recipientName,
        phone: address.phone,
        address: address.address,
      },
      db,
    )

    expect(order.userId).toBe(user.id)
    expect(order.status).toBe('pending')
    expect(order.totalAmount).toBe('13.50')
    expect(order.items).toHaveLength(2)
    expect(order.items[0].unitPrice).toBe('5.00')
    expect(order.items[0].subtotal).toBe('10.00')
  })

  test('includes shipping fee in totalAmount and stores the breakdown', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'fee-order', '5.00', 10)
    const address = await seedAddress(user.id)

    const order = await createOrderRecord(
      user.id,
      [{ skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity: 2 }],
      {
        addressId: address.id,
        recipientName: address.recipientName,
        phone: address.phone,
        address: address.address,
      },
      db,
      { shippingFeeCents: 600n },
    )

    // 商品 10.00 + 运费 6.00
    expect(order.totalAmount).toBe('16.00')
    expect(order.shippingFee).toBe('6.00')
  })

  test('defaults shipping fee to zero when not provided', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'fee-order-default', '5.00', 10)
    const address = await seedAddress(user.id)

    const order = await createOrderRecord(
      user.id,
      [{ skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity: 1 }],
      {
        addressId: address.id,
        recipientName: address.recipientName,
        phone: address.phone,
        address: address.address,
      },
      db,
    )

    expect(order.totalAmount).toBe('5.00')
    expect(order.shippingFee).toBe('0.00')
  })
})

describe('order queries', () => {
  test('getOrderForUser hides other users orders', async () => {
    const alice = await seedUser('alice@example.com')
    const bob = await seedUser('bob@example.com')
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(alice.id, sku.id)

    const owner = await getOrderForUser(alice.id, order.id, db)
    expect(owner.isOk()).toBe(true)
    const detail = owner._unsafeUnwrap()
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0].unitPrice).toBe('5.00')
    expect(detail.totalAmount).toBe('5.00')

    const stranger = await getOrderForUser(bob.id, order.id, db)
    expect(stranger.isErr()).toBe(true)
    expect(stranger._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })

  test('listOrdersByUser only returns own orders', async () => {
    const alice = await seedUser('alice@example.com')
    const bob = await seedUser('bob@example.com')
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    await seedOrder(alice.id, sku.id)
    await seedOrder(bob.id, sku.id)

    const list = await listOrdersByUser(alice.id, { page: 1, pageSize: 20 }, db)
    expect(list.total).toBe(1)
    expect(list.items[0].userId).toBe(alice.id)
  })

  test('getOrderById returns order with items', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const result = await getOrderById(order.id, db)
    expect(result.isOk()).toBe(true)
    const detail = result._unsafeUnwrap()
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0].unitPrice).toBe('5.00')
  })

  test('listOrders filters by status', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    await seedOrder(user.id, sku.id)

    const pending = await listOrders({ page: 1, pageSize: 20, status: 'pending' }, db)
    expect(pending.total).toBe(1)
    const paid = await listOrders({ page: 1, pageSize: 20, status: 'paid' }, db)
    expect(paid.total).toBe(0)
  })

  test('getOrderStatusCounts groups orders by status with zero-filled defaults', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)

    const counts = await getOrderStatusCounts(db)
    expect(counts.pending).toBe(0)
    expect(counts.paid).toBe(1)
    expect(counts.refunded).toBe(0)
    expect(counts.cancelled).toBe(0)
  })
})

describe('updateOrderStatus', () => {
  test('applies valid transitions and rejects invalid ones', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const toPaid = await updateOrderStatus(order.id, 'paid', db)
    expect(toPaid.isOk()).toBe(true)
    expect(toPaid._unsafeUnwrap().order.status).toBe('paid')

    const skipShipped = await updateOrderStatus(order.id, 'completed', db)
    expect(skipShipped.isErr()).toBe(true)
    expect(skipShipped._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')

    const toShipped = await updateOrderStatus(order.id, 'shipped', db)
    expect(toShipped.isOk()).toBe(true)
    const toCompleted = await updateOrderStatus(order.id, 'completed', db)
    expect(toCompleted.isOk()).toBe(true)

    const rewind = await updateOrderStatus(order.id, 'pending', db)
    expect(rewind.isErr()).toBe(true)
    expect(rewind._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
  })

  test('reports the transition origin via from', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const result = await updateOrderStatus(order.id, 'paid', db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().from).toBe('pending')
  })

  test('concurrent transitions never both originate from pending', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const results = await Promise.all([
      updateOrderStatus(order.id, 'paid', db),
      updateOrderStatus(order.id, 'cancelled', db),
    ])

    const fromPending = results.filter((r) => r.isOk() && r._unsafeUnwrap().from === 'pending')
    expect(fromPending.length).toBeLessThanOrEqual(1)
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(['paid', 'cancelled']).toContain(after.status)
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await updateOrderStatus('00000000-0000-4000-8000-000000000000', 'paid', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })
})

describe('shipOrder', () => {
  test('first shipment requires courierCompany and trackingNumber together', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'ship-both', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)

    // 都填: 通过
    const both = await shipOrder(order.id, 'SF123', 'sf', db)
    expect(both.isOk()).toBe(true)
    expect(both._unsafeUnwrap().order.courierCompany).toBe('sf')
    expect(both._unsafeUnwrap().from).toBe('paid')
  })

  test('first shipment with neither company nor tracking is allowed (后补/自送 path)', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'ship-neither', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)

    const result = await shipOrder(order.id, undefined, undefined, db)
    expect(result.isOk()).toBe(true)
    const shipped = result._unsafeUnwrap().order
    expect(shipped.courierCompany).toBeNull()
    expect(shipped.trackingNumber).toBeNull()
  })

  test('first shipment with only one of company/tracking is rejected', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'ship-one', '5.00', 10)
    const paidOrder = await seedOrder(user.id, sku.id)
    await updateOrderStatus(paidOrder.id, 'paid', db)

    // 只填承运商
    const companyOnly = await shipOrder(paidOrder.id, undefined, 'sf', db)
    expect(companyOnly.isErr()).toBe(true)
    expect(companyOnly._unsafeUnwrapErr()).toBe('SHIPMENT_INFO_INCOMPLETE')

    // 只填运单号
    const trackingOnly = await shipOrder(paidOrder.id, 'SF999', undefined, db)
    expect(trackingOnly.isErr()).toBe(true)
    expect(trackingOnly._unsafeUnwrapErr()).toBe('SHIPMENT_INFO_INCOMPLETE')

    // 订单状态未被破坏(仍可正常发货)
    const after = await shipOrder(paidOrder.id, 'SF999', 'sf', db)
    expect(after.isOk()).toBe(true)
  })

  test('re-ship allows partial update (correction path without re-validation)', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'ship-refix', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)
    await shipOrder(order.id, 'SF123', 'sf', db)

    // 已 shipped: 仅改运单号的补录/修正不受首发校验限制
    const reShip = await shipOrder(order.id, 'SF456', undefined, db)
    expect(reShip.isOk()).toBe(true)
    const shipped = reShip._unsafeUnwrap().order
    expect(shipped.trackingNumber).toBe('SF456')
    expect(shipped.courierCompany).toBe('sf')
    // re-ship 返回 from='shipped', 编排层据此不发事件
    expect(reShip._unsafeUnwrap().from).toBe('shipped')
  })

  test('ships a paid order with trackingNumber and shippedAt', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)

    const result = await shipOrder(order.id, 'SF123', 'sf', db)
    expect(result.isOk()).toBe(true)
    const shipped = result._unsafeUnwrap().order
    expect(shipped.status).toBe('shipped')
    expect(shipped.trackingNumber).toBe('SF123')
    expect(shipped.shippedAt).not.toBeNull()
    expect(shipped.items).toHaveLength(1)
  })

  test('re-shipping is idempotent and only updates the tracking number', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)
    await updateOrderStatus(order.id, 'paid', db)

    await shipOrder(order.id, 'SF123', 'sf', db)
    const reShip = await shipOrder(order.id, 'SF456', undefined, db)
    expect(reShip.isOk()).toBe(true)
    const shipped = reShip._unsafeUnwrap().order
    expect(shipped.status).toBe('shipped')
    expect(shipped.trackingNumber).toBe('SF456')
    expect(shipped.courierCompany).toBe('sf')
    expect(shipped.shippedAt).not.toBeNull()
  })

  test('rejects shipping a pending order with INVALID_TRANSITION', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const result = await shipOrder(order.id, 'SF123', undefined, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await shipOrder('00000000-0000-4000-8000-000000000000', 'SF123', undefined, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })
})

// 造一个已发货订单: pending → paid → shipped 全程走真实流转。
// slug 从邮箱派生保证唯一(同用例多次 seed 不撞 products_slug_unique)
async function seedShippedOrder(email = 'alice@example.com') {
  const user = await seedUser(email)
  const { sku } = await seedSku('Apple', `apple-${email.split('@')[0]}`, '5.00', 10)
  const order = await seedOrder(user.id, sku.id)
  await updateOrderStatus(order.id, 'paid', db)
  const shipped = await shipOrder(order.id, 'SF123', 'sf', db)
  return shipped._unsafeUnwrap().order
}

// 把 shipped_at 拨回过去(模拟发货已久, 触发自动完成窗口)
async function ageShippedAt(orderId: string, daysAgo: number) {
  await db
    .update(schema.orders)
    .set({ shippedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
    .where(eq(schema.orders.id, orderId))
}

describe('completeOrder', () => {
  test('completes a shipped order and stamps completedAt', async () => {
    const order = await seedShippedOrder()

    const result = await completeOrder(order.id, db)
    expect(result.isOk()).toBe(true)
    const completed = result._unsafeUnwrap()
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.items).toHaveLength(1)
  })

  test('rejects confirming a non-shipped order', async () => {
    const user = await seedUser('bob@example.com')
    const { sku } = await seedSku('Banana', 'banana', '3.00', 10)
    const order = await seedOrder(user.id, sku.id)

    const result = await completeOrder(order.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
  })

  test('double confirm is rejected by CAS (already completed)', async () => {
    const order = await seedShippedOrder()
    await completeOrder(order.id, db)

    const again = await completeOrder(order.id, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await completeOrder('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })
})

describe('autoCompleteShippedOrders', () => {
  test('completes only shipped orders past the window', async () => {
    const stale = await seedShippedOrder('alice@example.com')
    const fresh = await seedShippedOrder('bob@example.com')
    await ageShippedAt(stale.id, 8)
    // fresh 保持刚发货(默认 now)

    const completed = await autoCompleteShippedOrders(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      db,
    )
    expect(completed).toBe(1)

    const [staleRow] = await db.select().from(schema.orders).where(eq(schema.orders.id, stale.id))
    expect(staleRow.status).toBe('completed')
    expect(staleRow.completedAt).not.toBeNull()
    const [freshRow] = await db.select().from(schema.orders).where(eq(schema.orders.id, fresh.id))
    expect(freshRow.status).toBe('shipped')
    expect(freshRow.completedAt).toBeNull()
  })

  test('leaves other statuses untouched', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const paid = await seedOrder(user.id, sku.id)
    await updateOrderStatus(paid.id, 'paid', db)
    // 直接把 created_at 拨老: 即使很老, 非 shipped 也不该被动
    await db
      .update(schema.orders)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.orders.id, paid.id))

    const completed = await autoCompleteShippedOrders(new Date(), db)
    expect(completed).toBe(0)
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, paid.id))
    expect(row.status).toBe('paid')
  })

  test('respects the batch limit', async () => {
    const a = await seedShippedOrder('a@example.com')
    const b = await seedShippedOrder('b@example.com')
    const c = await seedShippedOrder('c@example.com')
    for (const o of [a, b, c]) await ageShippedAt(o.id, 8)

    const completed = await autoCompleteShippedOrders(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      db,
      2,
    )
    expect(completed).toBe(2)
  })

  test('excludes rejected/failed-delivery orders from auto-complete', async () => {
    const rejected = await seedShippedOrder('a@example.com')
    const normal = await seedShippedOrder('b@example.com')
    for (const o of [rejected, normal]) await ageShippedAt(o.id, 8)

    // 拒收单被排除, 普通单照常完成(排除集由 logistics 域查询后传入)
    const completed = await autoCompleteShippedOrders(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      db,
      undefined,
      [rejected.id],
    )
    expect(completed).toBe(1)

    const [rejectedRow] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, rejected.id))
    // 关键语义: 拒收单绝不能被超时"自动完成"
    expect(rejectedRow.status).toBe('shipped')
    const [normalRow] = await db.select().from(schema.orders).where(eq(schema.orders.id, normal.id))
    expect(normalRow.status).toBe('completed')
  })
})
