import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

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

describe('checkoutWorkflow', () => {
  test('reduces stock on successful checkout', async () => {
    const { sku } = await seedSku(10)
    const result = await checkoutWorkflow({ userId: 'u1', skuId: sku.id, quantity: 4 }, db)
    expect(result.isOk()).toBe(true)
    const [after] = await db.$client<{ stock: number }[]>`
      SELECT stock FROM product_skus WHERE id = ${sku.id}
    `
    expect(after.stock).toBe(6)
  })

  test('returns SKU_NOT_FOUND for unknown sku', async () => {
    const result = await checkoutWorkflow(
      { userId: 'u1', skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
      db,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
  })

  test('returns INSUFFICIENT_STOCK when quantity exceeds stock', async () => {
    const { sku } = await seedSku(2)
    const result = await checkoutWorkflow({ userId: 'u1', skuId: sku.id, quantity: 3 }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INSUFFICIENT_STOCK')
  })
})
