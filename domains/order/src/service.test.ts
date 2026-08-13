import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  createOrderRecord,
  getOrderById,
  getOrderForUser,
  getOrderStatusCounts,
  listOrders,
  listOrdersByUser,
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
    db,
    userId,
    [{ skuId, productName: 'Apple', skuName: '1kg', unitPrice, quantity }],
    {
      addressId: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      address: address.address,
    },
  )
}

describe('createOrderRecord', () => {
  test('persists order with computed total and snapshot lines', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const address = await seedAddress(user.id)

    const order = await createOrderRecord(
      db,
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
    )

    expect(order.userId).toBe(user.id)
    expect(order.status).toBe('pending')
    expect(order.totalAmount).toBe('13.50')
    expect(order.items).toHaveLength(2)
    expect(order.items[0].unitPrice).toBe('5.00')
    expect(order.items[0].subtotal).toBe('10.00')
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
