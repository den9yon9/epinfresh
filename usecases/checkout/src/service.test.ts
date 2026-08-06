import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { count, eq } from 'drizzle-orm'

import { checkoutWorkflow } from './service'

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

describe('checkoutWorkflow', () => {
  test('creates order with price/name snapshots and reduces stock', async () => {
    const user = await seedUser()
    const { sku: apple } = await seedSku('Apple', 'apple', '5.00', 10)
    const { sku: banana } = await seedSku('Banana', 'banana', '3.50', 5)

    const result = await checkoutWorkflow(
      {
        userId: user.id,
        items: [
          { skuId: apple.id, quantity: 2 },
          { skuId: banana.id, quantity: 1 },
        ],
      },
      db,
    )

    expect(result.isOk()).toBe(true)
    const order = result._unsafeUnwrap()
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

  test('returns SKU_NOT_FOUND and creates no order', async () => {
    const user = await seedUser()
    const result = await checkoutWorkflow(
      {
        userId: user.id,
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
    const { sku } = await seedSku('Apple', 'apple-draft', '5.00', 10, 'draft')

    const result = await checkoutWorkflow(
      { userId: user.id, items: [{ skuId: sku.id, quantity: 1 }] },
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

  test('insufficient stock rolls back the whole order', async () => {
    const user = await seedUser()
    const { sku: apple } = await seedSku('Apple', 'apple', '5.00', 10)
    const { sku: banana } = await seedSku('Banana', 'banana', '3.00', 1)

    const result = await checkoutWorkflow(
      {
        userId: user.id,
        items: [
          { skuId: apple.id, quantity: 2 },
          { skuId: banana.id, quantity: 5 },
        ],
      },
      db,
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INSUFFICIENT_STOCK')
    expect(await orderCount()).toBe(0)
    const [afterApple] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, apple.id))
    expect(Number(afterApple.stock)).toBe(10)
  })

  test('concurrent checkouts do not oversell', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const results = await Promise.all([
      checkoutWorkflow({ userId: user.id, items: [{ skuId: sku.id, quantity: 6 }] }, db),
      checkoutWorkflow({ userId: user.id, items: [{ skuId: sku.id, quantity: 6 }] }, db),
    ])

    expect(results.filter((r) => r.isOk())).toHaveLength(1)
    expect(
      results.filter((r) => r.isErr() && r._unsafeUnwrapErr() === 'INSUFFICIENT_STOCK'),
    ).toHaveLength(1)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(4)
    expect(await orderCount()).toBe(1)
  })
})
