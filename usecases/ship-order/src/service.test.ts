import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { updateOrderStatus } from '@epinfresh/order'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

import { shipOrder } from './service'

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

async function seedPaidOrder(email = 'alice@example.com', slugSuffix = 'ship') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email, passwordHash: 'not-a-real-hash' })
    .returning()
  const [product] = await db
    .insert(schema.products)
    .values({ name: 'Apple', slug: `apple-${slugSuffix}`, status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({
      productId: product.id,
      name: '1kg',
      skuCode: `${slugSuffix.toUpperCase()}-1KG`,
      price: '5.00',
      stock: 10,
    })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status: 'pending', totalAmount: '10.00' })
    .returning()
  await db.insert(schema.orderItems).values({
    orderId: order.id,
    skuId: sku.id,
    productName: product.name,
    skuName: sku.name,
    unitPrice: sku.price,
    quantity: 2,
    subtotal: '10.00',
  })
  await updateOrderStatus(order.id, 'paid', db)
  return order
}

async function shippedEvents(orderId: string) {
  return db
    .select()
    .from(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.eventType, 'order.shipped'),
        eq(schema.outboxEvents.aggregateId, orderId),
      ),
    )
}

describe('shipOrder (usecase)', () => {
  test('paid → shipped transition writes order.shipped in the same unit of work', async () => {
    const order = await seedPaidOrder()

    const result = await shipOrder(order.id, 'SF123', 'sf', db)

    expect(result.isOk()).toBe(true)
    const events = await shippedEvents(order.id)
    expect(events).toHaveLength(1)
    expect(events[0].status).toBe('pending')
    const payload = events[0].payload as Record<string, unknown>
    expect(payload.orderId).toBe(order.id)
    expect(payload.trackingNumber).toBe('SF123')
    expect(payload.courierCompany).toBe('sf')
  })

  test('first shipment without courier info still emits the event', async () => {
    const order = await seedPaidOrder('bob@example.com', 'ship2')

    const result = await shipOrder(order.id, undefined, undefined, db)

    expect(result.isOk()).toBe(true)
    expect(await shippedEvents(order.id)).toHaveLength(1)
  })

  test('re-ship (tracking correction) does not re-emit the event', async () => {
    const order = await seedPaidOrder('carol@example.com', 'ship3')
    await shipOrder(order.id, 'SF123', 'sf', db)

    const reShip = await shipOrder(order.id, 'SF456', undefined, db)

    expect(reShip.isOk()).toBe(true)
    expect(await shippedEvents(order.id)).toHaveLength(1)
  })

  test('failed transition (pending order) writes no event', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ name: 'Dave', email: 'dave@example.com', passwordHash: 'not-a-real-hash' })
      .returning()
    const [product] = await db
      .insert(schema.products)
      .values({ name: 'Pear', slug: 'pear-pending', status: 'published' })
      .returning()
    const [sku] = await db
      .insert(schema.productSkus)
      .values({ productId: product.id, name: '1kg', skuCode: 'PEAR-1KG', price: '5.00', stock: 10 })
      .returning()
    const [order] = await db
      .insert(schema.orders)
      .values({ userId: user.id, status: 'pending', totalAmount: '5.00' })
      .returning()
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      skuId: sku.id,
      productName: product.name,
      skuName: sku.name,
      unitPrice: sku.price,
      quantity: 1,
      subtotal: '5.00',
    })

    const result = await shipOrder(order.id, 'SF123', 'sf', db)

    expect(result.isErr()).toBe(true)
    expect(await shippedEvents(order.id)).toHaveLength(0)
  })
})
