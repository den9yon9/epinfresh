import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  createCategory,
  createProduct,
  listPublishedProducts,
  reduceProductStock,
  removeCategory,
  restoreProductStock,
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

async function seedSku(stock = 10) {
  const [product] = await db
    .insert(schema.products)
    .values({ name: 'Apple', slug: 'apple', status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({ productId: product.id, name: '1kg', skuCode: 'APPLE-1KG', price: '5.00', stock })
    .returning()
  return { product, sku }
}

describe('reduceProductStock', () => {
  test('decrements stock and returns ok', async () => {
    const { sku } = await seedSku(10)
    const result = await reduceProductStock(sku.id, 3, db)
    expect(result.isOk()).toBe(true)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(7)
  })

  test('returns SKU_NOT_FOUND for unknown sku', async () => {
    const result = await reduceProductStock('00000000-0000-4000-8000-000000000000', 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
  })

  test('returns INSUFFICIENT_STOCK when quantity exceeds stock', async () => {
    const { sku } = await seedSku(5)
    const result = await reduceProductStock(sku.id, 6, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INSUFFICIENT_STOCK')
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(5)
  })

  test('does not go negative when stock is zero', async () => {
    const { sku } = await seedSku(0)
    const result = await reduceProductStock(sku.id, 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INSUFFICIENT_STOCK')
  })
})

describe('restoreProductStock', () => {
  test('increments stock and returns ok', async () => {
    const { sku } = await seedSku(7)
    const result = await restoreProductStock(sku.id, 3, db)
    expect(result.isOk()).toBe(true)
    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(10)
  })

  test('returns SKU_NOT_FOUND for unknown sku', async () => {
    const result = await restoreProductStock('00000000-0000-4000-8000-000000000000', 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
  })
})

describe('createProduct', () => {
  test('creates product with skus', async () => {
    const product = await createProduct(
      {
        name: 'Orange',
        slug: 'orange',
        status: 'published',
        images: [],
        skus: [{ name: '1kg', skuCode: 'ORANGE-1KG', price: 6.5, stock: 20, attributes: {} }],
      },
      db,
    )
    expect(product.name).toBe('Orange')
    expect(product.skus).toHaveLength(1)
    const [persisted] = await db
      .select({ stock: schema.productSkus.stock })
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, product.id))
    expect(Number(persisted.stock)).toBe(20)
  })
})

describe('listPublishedProducts', () => {
  test('only returns published products', async () => {
    await createProduct({ name: 'Draft', slug: 'draft', images: [] }, db)
    const { sku } = await seedSku()
    const result = await listPublishedProducts({ page: 1, pageSize: 20 }, db)
    expect(result.total).toBe(1)
    expect(result.items[0].id).toBe(sku.productId)
  })
})

describe('removeCategory', () => {
  test('refuses to remove category that still has products', async () => {
    const [category] = await db
      .insert(schema.categories)
      .values({ name: 'Fruit', slug: 'fruit' })
      .returning()
    await createProduct({ name: 'Apple', slug: 'apple', categoryId: category.id, images: [] }, db)
    const result = await removeCategory(category.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CATEGORY_HAS_PRODUCTS')
  })

  test('removes empty category', async () => {
    const category = await createCategory({ name: 'Empty', slug: 'empty' }, db)
    const result = await removeCategory(category.id, db)
    expect(result.isOk()).toBe(true)
  })
})
