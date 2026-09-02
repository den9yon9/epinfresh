import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { addItemToCart, changeCartItemQuantity, viewCart } from './service'

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
  status: 'published' | 'draft' = 'published',
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

describe('addItemToCart', () => {
  test('adds an item with sku/product details', async () => {
    const user = await seedUser()
    const { product, sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const result = await addItemToCart(user.id, sku.id, 2, db)
    expect(result.isOk()).toBe(true)
    const item = result._unsafeUnwrap()
    expect(item.quantity).toBe(2)
    expect(item.sku.id).toBe(sku.id)
    expect(item.sku.price).toBe('5.00')
    expect(item.product.id).toBe(product.id)
    expect(item.product.status).toBe('published')
  })

  test('merges quantity for the same sku', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    await addItemToCart(user.id, sku.id, 3, db)
    const merged = await addItemToCart(user.id, sku.id, 4, db)
    expect(merged.isOk()).toBe(true)
    expect(merged._unsafeUnwrap().quantity).toBe(7)
  })

  test('returns SKU_NOT_FOUND for unknown sku', async () => {
    const user = await seedUser()
    const result = await addItemToCart(user.id, '00000000-0000-4000-8000-000000000000', 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
  })

  test('rejects sku whose product is not published', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple-draft', '5.00', 10, 'draft')

    const result = await addItemToCart(user.id, sku.id, 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PRODUCT_UNAVAILABLE')
  })
})

describe('viewCart', () => {
  test('lists own items with details', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const { product, sku } = await seedSku('Apple', 'apple')
    await addItemToCart(user.id, sku.id, 2, db)
    await addItemToCart(other.id, sku.id, 5, db)

    const { items } = await viewCart(user.id, db)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(2)
    expect(items[0].sku.id).toBe(sku.id)
    expect(items[0].product.name).toBe(product.name)
  })
})

describe('changeCartItemQuantity', () => {
  test('sets the quantity', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')
    await addItemToCart(user.id, sku.id, 2, db)

    const result = await changeCartItemQuantity(user.id, sku.id, 8, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().quantity).toBe(8)
  })

  test('returns CART_ITEM_NOT_FOUND when the item is absent', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    const result = await changeCartItemQuantity(user.id, sku.id, 3, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CART_ITEM_NOT_FOUND')
  })
})
