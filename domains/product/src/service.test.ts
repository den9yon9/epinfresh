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
  updateCategory,
  updateProduct,
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
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      skuId: sku.id,
      available: 5,
    })
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
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      skuId: sku.id,
      available: 0,
    })
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

describe('updateProduct', () => {
  async function seedProduct() {
    return createProduct(
      {
        name: 'Orange',
        slug: 'orange',
        status: 'draft',
        images: [],
        skus: [{ name: '1kg', skuCode: 'ORANGE-1KG', price: 6.5, stock: 20, attributes: {} }],
      },
      db,
    )
  }

  test('updates product fields and keeps skus unchanged', async () => {
    const product = await seedProduct()
    const updated = await updateProduct(product.id, { name: 'Apple', status: 'published' }, db)
    expect(updated._unsafeUnwrap().name).toBe('Apple')
    expect(updated._unsafeUnwrap().status).toBe('published')
    expect(updated._unsafeUnwrap().skus).toHaveLength(1)
  })

  test('updates existing sku by id', async () => {
    const product = await seedProduct()
    const [sku] = product.skus
    const updated = await updateProduct(
      product.id,
      { skus: [{ id: sku.id, name: '2kg', skuCode: 'ORANGE-2KG', price: 12, stock: 5 }] },
      db,
    )
    const [after] = updated._unsafeUnwrap().skus
    expect(after.name).toBe('2kg')
    expect(after.price).toBe('12.00')
    expect(Number(after.stock)).toBe(5)
  })

  test('inserts new sku without id', async () => {
    const product = await seedProduct()
    const updated = await updateProduct(
      product.id,
      { skus: [{ name: '5kg', skuCode: 'ORANGE-5KG', price: 25, stock: 2 }] },
      db,
    )
    expect(updated._unsafeUnwrap().skus).toHaveLength(2)
    expect(updated._unsafeUnwrap().skus.map((s) => s.skuCode)).toContain('ORANGE-5KG')
  })

  test('silently skips sku id belonging to another product', async () => {
    const productA = await seedProduct()
    const productB = await createProduct(
      {
        name: 'Banana',
        slug: 'banana',
        images: [],
        skus: [{ name: '1kg', skuCode: 'BANANA-1KG', price: 3 }],
      },
      db,
    )
    const [otherSku] = productB.skus
    const updated = await updateProduct(
      productA.id,
      { skus: [{ id: otherSku.id, name: 'hacked', skuCode: 'BANANA-1KG', price: 99 }] },
      db,
    )
    expect(updated._unsafeUnwrap().skus).toHaveLength(1)
    const [check] = await db
      .select({ name: schema.productSkus.name })
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, otherSku.id))
    expect(check.name).toBe('1kg')
  })

  test('duplicate skuCode rolls back the whole update', async () => {
    const product = await seedProduct()
    await createProduct(
      {
        name: 'Banana',
        slug: 'banana',
        images: [],
        skus: [{ name: '1kg', skuCode: 'TAKEN-1', price: 3 }],
      },
      db,
    )
    expect(
      updateProduct(
        product.id,
        { name: 'Renamed', skus: [{ name: 'x', skuCode: 'TAKEN-1', price: 1 }] },
        db,
      ),
    ).rejects.toThrow()
    const [after] = await db
      .select({ name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.id, product.id))
    expect(after.name).toBe('Orange')
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

  test('filters by keyword, ignoring LIKE wildcards in input', async () => {
    await createProduct(
      { name: 'Organic Tomato', slug: 'organic-tomato', status: 'published', images: [] },
      db,
    )
    await createProduct(
      { name: 'Local Cucumber', slug: 'local-cucumber', status: 'published', images: [] },
      db,
    )
    const exact = await listPublishedProducts({ page: 1, pageSize: 20, q: 'tomato' }, db)
    expect(exact.total).toBe(1)
    expect(exact.items[0].name).toBe('Organic Tomato')
    const wildcard = await listPublishedProducts({ page: 1, pageSize: 20, q: '%' }, db)
    expect(wildcard.total).toBe(0)
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

describe('updateCategory', () => {
  test('updates name, slug, parent and sortOrder', async () => {
    const parent = await createCategory({ name: 'Food', slug: 'food' }, db)
    const child = await createCategory({ name: 'Fruit', slug: 'fruit' }, db)

    const updated = await updateCategory(
      child.id,
      { name: 'Fresh Fruit', slug: 'fresh-fruit', parentId: parent.id, sortOrder: 3 },
      db,
    )
    expect(updated.isOk()).toBe(true)
    if (updated.isErr()) throw updated.error
    expect(updated.value.name).toBe('Fresh Fruit')
    expect(updated.value.slug).toBe('fresh-fruit')
    expect(updated.value.parentId).toBe(parent.id)
    expect(updated.value.sortOrder).toBe(3)
  })

  test('returns CATEGORY_NOT_FOUND for missing category', async () => {
    const result = await updateCategory(
      '00000000-0000-4000-8000-000000000000',
      { name: 'Ghost' },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CATEGORY_NOT_FOUND')
  })

  test('returns CATEGORY_PARENT_NOT_FOUND for missing parent', async () => {
    const child = await createCategory({ name: 'Fruit', slug: 'fruit' }, db)
    const result = await updateCategory(
      child.id,
      { parentId: '00000000-0000-4000-8000-000000000000' },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CATEGORY_PARENT_NOT_FOUND')
  })

  test('rejects setting itself as parent', async () => {
    const cat = await createCategory({ name: 'Fruit', slug: 'fruit' }, db)
    const result = await updateCategory(cat.id, { parentId: cat.id }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CATEGORY_CYCLE')
  })

  test('rejects setting a descendant as parent', async () => {
    const parent = await createCategory({ name: 'Food', slug: 'food' }, db)
    const child = await createCategory({ name: 'Fruit', slug: 'fruit', parentId: parent.id }, db)
    const grandchild = await createCategory(
      { name: 'Apple', slug: 'apple', parentId: child.id },
      db,
    )
    const result = await updateCategory(parent.id, { parentId: grandchild.id }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CATEGORY_CYCLE')
  })
})
