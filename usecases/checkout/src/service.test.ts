import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { count, eq } from 'drizzle-orm'

import { checkout } from './service'

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

async function seedAddress(userId: string) {
  const [address] = await db
    .insert(schema.addresses)
    .values({
      userId,
      recipientName: 'Alice',
      phone: '13800000000',
      address: 'Shanghai Pudong',
      isDefault: true,
    })
    .returning()
  return address
}

async function seedSku(
  name: string,
  slug: string,
  price = '5.00',
  stock = 10,
  status: ProductStatus = 'published',
) {
  const [product] = await db.insert(schema.products).values({ name, slug, status }).returning()
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

async function orderCount() {
  const [{ total }] = await db.select({ total: count() }).from(schema.orders)
  return Number(total)
}

describe('checkout', () => {
  test('creates order with price/name snapshots and reduces stock', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku: apple } = await seedSku('Apple', 'apple', '5.00', 10)
    const { sku: banana } = await seedSku('Banana', 'banana', '3.50', 5)

    const result = await checkout(
      {
        userId: user.id,
        addressId: address.id,
        items: [
          { skuId: apple.id, quantity: 2 },
          { skuId: banana.id, quantity: 1 },
        ],
      },
      db,
    )

    expect(result.isOk()).toBe(true)
    const { order, replayed } = result._unsafeUnwrap()
    expect(replayed).toBe(false)
    expect(order.userId).toBe(user.id)
    expect(order.status).toBe('pending')
    expect(order.totalAmount).toBe('13.50')
    expect(order.items).toHaveLength(2)

    const line = order.items.find((i) => i.skuId === apple.id)!
    expect(line.productName).toBe('Apple')
    expect(line.skuName).toBe('1kg')
    expect(line.unitPrice).toBe('5.00')
    expect(line.quantity).toBe(2)
    expect(line.subtotal).toBe('10.00')

    const [afterApple] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, apple.id))
    const [afterBanana] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, banana.id))
    expect(Number(afterApple.stock)).toBe(8)
    expect(Number(afterBanana.stock)).toBe(4)
  })

  test('clears only the checked-out skus from the cart', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku: apple } = await seedSku('Apple', 'apple2', '5.00', 10)
    const { sku: banana } = await seedSku('Banana', 'banana2', '3.50', 5)
    await db.insert(schema.cartItems).values([
      { userId: user.id, skuId: apple.id, quantity: 2 },
      { userId: user.id, skuId: banana.id, quantity: 1 },
    ])

    const result = await checkout(
      { userId: user.id, addressId: address.id, items: [{ skuId: apple.id, quantity: 2 }] },
      db,
    )
    expect(result.isOk()).toBe(true)

    const [appleRow] = await db
      .select()
      .from(schema.cartItems)
      .where(eq(schema.cartItems.skuId, apple.id))
    const [bananaRow] = await db
      .select()
      .from(schema.cartItems)
      .where(eq(schema.cartItems.skuId, banana.id))
    expect(appleRow).toBeUndefined()
    expect(bananaRow).toBeDefined()
    expect(bananaRow.quantity).toBe(1)
  })

  test('returns SKU_NOT_FOUND and creates no order', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const result = await checkout(
      {
        userId: user.id,
        addressId: address.id,
        items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
    expect(await orderCount()).toBe(0)
  })

  test('rejects SKU whose product is not published', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple-draft', '5.00', 10, 'draft')

    const result = await checkout(
      { userId: user.id, addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      db,
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PRODUCT_UNAVAILABLE')
    expect(await orderCount()).toBe(0)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(10)
  })

  test('merges duplicate SKUs into a single line', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const result = await checkout(
      {
        userId: user.id,
        addressId: address.id,
        items: [
          { skuId: sku.id, quantity: 2 },
          { skuId: sku.id, quantity: 3 },
        ],
      },
      db,
    )

    expect(result.isOk()).toBe(true)
    const { order } = result._unsafeUnwrap()
    expect(order.items).toHaveLength(1)
    expect(order.items[0].quantity).toBe(5)
    expect(order.totalAmount).toBe('25.00')
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(5)
  })

  test('insufficient stock rolls back the whole order', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku: apple } = await seedSku('Apple', 'apple', '5.00', 10)
    const { sku: banana } = await seedSku('Banana', 'banana', '3.00', 1)

    const result = await checkout(
      {
        userId: user.id,
        addressId: address.id,
        items: [
          { skuId: apple.id, quantity: 2 },
          { skuId: banana.id, quantity: 5 },
        ],
      },
      db,
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      skuId: banana.id,
      available: 1,
    })
    expect(await orderCount()).toBe(0)
    const [afterApple] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, apple.id))
    expect(Number(afterApple.stock)).toBe(10)
  })

  test('concurrent checkouts do not oversell', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const results = await Promise.all([
      checkout(
        { userId: user.id, addressId: address.id, items: [{ skuId: sku.id, quantity: 6 }] },
        db,
      ),
      checkout(
        { userId: user.id, addressId: address.id, items: [{ skuId: sku.id, quantity: 6 }] },
        db,
      ),
    ])

    expect(results.filter((r) => r.isOk())).toHaveLength(1)
    const failed = results.filter((r) => r.isErr())
    expect(failed).toHaveLength(1)
    expect(failed[0]!._unsafeUnwrapErr()).toMatchObject({ code: 'INSUFFICIENT_STOCK' })
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(4)
    expect(await orderCount()).toBe(1)
  })

  test('same idempotency key replays the existing order without re-deducting stock', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const first = await checkout(
      {
        userId: user.id,
        idempotencyKey: 'key-1',
        addressId: address.id,
        items: [{ skuId: sku.id, quantity: 2 }],
      },
      db,
    )
    expect(first.isOk()).toBe(true)
    expect(first._unsafeUnwrap().replayed).toBe(false)
    const orderId = first._unsafeUnwrap().order.id

    const second = await checkout(
      {
        userId: user.id,
        idempotencyKey: 'key-1',
        addressId: address.id,
        items: [{ skuId: sku.id, quantity: 2 }],
      },
      db,
    )
    expect(second.isOk()).toBe(true)
    const replay = second._unsafeUnwrap()
    expect(replay.replayed).toBe(true)
    expect(replay.order.id).toBe(orderId)

    expect(await orderCount()).toBe(1)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(8)
  })

  test('idempotency keys are scoped per user', async () => {
    const alice = await seedUser('alice@example.com')
    const aliceAddress = await seedAddress(alice.id)
    const bob = await seedUser('bob@example.com')
    const bobAddress = await seedAddress(bob.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const aliceOrder = await checkout(
      {
        userId: alice.id,
        idempotencyKey: 'shared-key',
        addressId: aliceAddress.id,
        items: [{ skuId: sku.id, quantity: 1 }],
      },
      db,
    )
    expect(aliceOrder.isOk()).toBe(true)

    const bobOrder = await checkout(
      {
        userId: bob.id,
        idempotencyKey: 'shared-key',
        addressId: bobAddress.id,
        items: [{ skuId: sku.id, quantity: 1 }],
      },
      db,
    )
    expect(bobOrder.isOk()).toBe(true)
    expect(bobOrder._unsafeUnwrap().replayed).toBe(false)
    expect(bobOrder._unsafeUnwrap().order.id).not.toBe(aliceOrder._unsafeUnwrap().order.id)
    expect(await orderCount()).toBe(2)
  })

  test('concurrent same-key checkouts create only one order', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const results = await Promise.all([
      checkout(
        {
          userId: user.id,
          idempotencyKey: 'race-key',
          addressId: address.id,
          items: [{ skuId: sku.id, quantity: 2 }],
        },
        db,
      ),
      checkout(
        {
          userId: user.id,
          idempotencyKey: 'race-key',
          addressId: address.id,
          items: [{ skuId: sku.id, quantity: 2 }],
        },
        db,
      ),
    ])

    const okResults = results.filter((r) => r.isOk())
    expect(okResults).toHaveLength(2)
    const orderIds = new Set(okResults.map((r) => r._unsafeUnwrap().order.id))
    expect(orderIds.size).toBe(1)
    expect(await orderCount()).toBe(1)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(8)
  })

  test('returns ADDRESS_NOT_FOUND for an address not owned by the user', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const otherAddress = await seedAddress(other.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const result = await checkout(
      { userId: user.id, addressId: otherAddress.id, items: [{ skuId: sku.id, quantity: 2 }] },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ADDRESS_NOT_FOUND')
    expect(await orderCount()).toBe(0)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(10)
  })

  test('failed checkout does not persist the idempotency key', async () => {
    const user = await seedUser()
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const failed = await checkout(
      {
        userId: user.id,
        idempotencyKey: 'fail-key',
        addressId: address.id,
        items: [{ skuId: sku.id, quantity: 99 }],
      },
      db,
    )
    expect(failed.isErr()).toBe(true)
    expect(failed._unsafeUnwrapErr()).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      skuId: sku.id,
      available: 10,
    })

    const retry = await checkout(
      {
        userId: user.id,
        idempotencyKey: 'fail-key',
        addressId: address.id,
        items: [{ skuId: sku.id, quantity: 1 }],
      },
      db,
    )
    expect(retry.isOk()).toBe(true)
    expect(retry._unsafeUnwrap().replayed).toBe(false)
    expect(await orderCount()).toBe(1)
  })
})
