import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  addToCart,
  clearCart,
  listCart,
  removeCartItem,
  removeCartItems,
  updateCartItem,
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

async function cartRows(userId: string) {
  return db.select().from(schema.cartItems).where(eq(schema.cartItems.userId, userId))
}

describe('addToCart', () => {
  test('adds an item with sku/product details', async () => {
    const user = await seedUser()
    const { product, sku } = await seedSku('Apple', 'apple', '5.00', 10)

    const result = await addToCart(user.id, sku.id, 2, db)
    expect(result.isOk()).toBe(true)
    const item = result._unsafeUnwrap()
    expect(item.quantity).toBe(2)
    expect(item.sku.id).toBe(sku.id)
    expect(item.sku.price).toBe('5.00')
    expect(item.product.id).toBe(product.id)
    expect(item.product.status).toBe('published')
  })

  test('merges quantity for the same sku with a cap of 9999', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    await addToCart(user.id, sku.id, 3, db)
    const merged = await addToCart(user.id, sku.id, 4, db)
    expect(merged.isOk()).toBe(true)
    expect(merged._unsafeUnwrap().quantity).toBe(7)

    const rows = await cartRows(user.id)
    expect(rows).toHaveLength(1)

    await addToCart(user.id, sku.id, 9999, db)
    const capped = await addToCart(user.id, sku.id, 5, db)
    expect(capped.isOk()).toBe(true)
    expect(capped._unsafeUnwrap().quantity).toBe(9999)
  })

  test('returns SKU_NOT_FOUND for unknown sku', async () => {
    const user = await seedUser()
    const result = await addToCart(user.id, '00000000-0000-4000-8000-000000000000', 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('SKU_NOT_FOUND')
  })

  test('rejects sku whose product is not published', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple-draft', '5.00', 10, 'draft')

    const result = await addToCart(user.id, sku.id, 1, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('PRODUCT_UNAVAILABLE')
  })

  test('concurrent adds never create duplicate rows', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    await Promise.all([
      addToCart(user.id, sku.id, 1, db),
      addToCart(user.id, sku.id, 1, db),
      addToCart(user.id, sku.id, 1, db),
    ])
    const rows = await cartRows(user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(3)
  })
})

describe('listCart', () => {
  test('lists own items only', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const { sku } = await seedSku('Apple', 'apple')
    await addToCart(user.id, sku.id, 2, db)
    await addToCart(other.id, sku.id, 5, db)

    const { items } = await listCart(user.id, db)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(2)
  })
})

describe('updateCartItem', () => {
  test('sets the quantity', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')
    await addToCart(user.id, sku.id, 2, db)

    const result = await updateCartItem(user.id, sku.id, 8, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().quantity).toBe(8)
  })

  test('returns CART_ITEM_NOT_FOUND when the item is absent', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    const result = await updateCartItem(user.id, sku.id, 3, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CART_ITEM_NOT_FOUND')
  })
})

describe('removeCartItem and clearCart', () => {
  test('removes one item', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')
    await addToCart(user.id, sku.id, 2, db)

    const result = await removeCartItem(user.id, sku.id, db)
    expect(result.isOk()).toBe(true)
    expect(await cartRows(user.id)).toHaveLength(0)
  })

  test('removing an absent item returns CART_ITEM_NOT_FOUND', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple')

    const result = await removeCartItem(user.id, sku.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('CART_ITEM_NOT_FOUND')
  })

  test('clearCart empties only the user cart', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const { sku } = await seedSku('Apple', 'apple')
    await addToCart(user.id, sku.id, 2, db)
    await addToCart(other.id, sku.id, 2, db)

    await clearCart(user.id, db)
    expect(await cartRows(user.id)).toHaveLength(0)
    expect(await cartRows(other.id)).toHaveLength(1)
  })
})

describe('removeCartItems', () => {
  test('removes only the matching skus and keeps others', async () => {
    const user = await seedUser()
    const { sku: apple } = await seedSku('Apple', 'apple')
    const { sku: banana } = await seedSku('Banana', 'banana')
    await addToCart(user.id, apple.id, 2, db)
    await addToCart(user.id, banana.id, 1, db)

    const result = await removeCartItems(user.id, [apple.id], db)

    expect(result).toEqual({ removed: true })
    const rows = await cartRows(user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].skuId).toBe(banana.id)
  })

  test('ignores skuIds that are not in the cart', async () => {
    const user = await seedUser()
    const { sku: apple } = await seedSku('Apple', 'apple')
    const { sku: banana } = await seedSku('Banana', 'banana')
    await addToCart(user.id, banana.id, 1, db)

    await removeCartItems(user.id, [apple.id, '00000000-0000-4000-8000-000000000000'], db)

    const rows = await cartRows(user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].skuId).toBe(banana.id)
  })

  test('does not remove items belonging to another user', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const { sku } = await seedSku('Apple', 'apple')
    await addToCart(user.id, sku.id, 2, db)
    await addToCart(other.id, sku.id, 5, db)

    await removeCartItems(user.id, [sku.id], db)

    expect(await cartRows(user.id)).toHaveLength(0)
    const otherRows = await cartRows(other.id)
    expect(otherRows).toHaveLength(1)
    expect(otherRows[0].quantity).toBe(5)
  })
})
