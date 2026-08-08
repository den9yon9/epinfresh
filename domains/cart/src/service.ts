import { type DbClient, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq, sql } from 'drizzle-orm'

export type CartErrorCode = 'SKU_NOT_FOUND' | 'PRODUCT_UNAVAILABLE' | 'CART_ITEM_NOT_FOUND'

export type CartItemDetail = {
  id: string
  quantity: number
  createdAt: Date
  updatedAt: Date
  sku: {
    id: string
    name: string
    skuCode: string
    price: string
    stock: number
    attributes: Record<string, string>
  }
  product: {
    id: string
    name: string
    slug: string
    images: string[]
    status: string
  }
}

function cartItemDetail(row: {
  cartItemId: string
  quantity: number
  cartItemCreatedAt: Date
  cartItemUpdatedAt: Date
  skuId: string
  skuName: string
  skuCode: string
  price: string
  stock: number
  attributes: Record<string, string>
  productId: string
  productName: string
  slug: string
  images: string[]
  status: string
}): CartItemDetail {
  return {
    id: row.cartItemId,
    quantity: row.quantity,
    createdAt: row.cartItemCreatedAt,
    updatedAt: row.cartItemUpdatedAt,
    sku: {
      id: row.skuId,
      name: row.skuName,
      skuCode: row.skuCode,
      price: row.price,
      stock: row.stock,
      attributes: row.attributes,
    },
    product: {
      id: row.productId,
      name: row.productName,
      slug: row.slug,
      images: row.images,
      status: row.status,
    },
  }
}

const cartWithDetails = {
  cartItemId: schema.cartItems.id,
  quantity: schema.cartItems.quantity,
  cartItemCreatedAt: schema.cartItems.createdAt,
  cartItemUpdatedAt: schema.cartItems.updatedAt,
  skuId: schema.productSkus.id,
  skuName: schema.productSkus.name,
  skuCode: schema.productSkus.skuCode,
  price: schema.productSkus.price,
  stock: schema.productSkus.stock,
  attributes: schema.productSkus.attributes,
  productId: schema.products.id,
  productName: schema.products.name,
  slug: schema.products.slug,
  images: schema.products.images,
  status: schema.products.status,
}

export async function addToCart(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<CartItemDetail, 'SKU_NOT_FOUND' | 'PRODUCT_UNAVAILABLE'>> {
  const [sku] = await client
    .select({
      id: schema.productSkus.id,
      productId: schema.productSkus.productId,
      productStatus: schema.products.status,
    })
    .from(schema.productSkus)
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(eq(schema.productSkus.id, skuId))
  if (!sku) return err('SKU_NOT_FOUND')
  if (sku.productStatus !== 'published') return err('PRODUCT_UNAVAILABLE')

  await client
    .insert(schema.cartItems)
    .values({ userId, skuId, quantity })
    .onConflictDoUpdate({
      target: [schema.cartItems.userId, schema.cartItems.skuId],
      set: { quantity: sql`LEAST(${schema.cartItems.quantity} + excluded.quantity, 9999)` },
    })
  const item = await getCartItem(userId, skuId, client)
  return ok(item)
}

export async function listCart(
  userId: string,
  client: DbClient,
): Promise<{ items: CartItemDetail[] }> {
  const rows = await client
    .select(cartWithDetails)
    .from(schema.cartItems)
    .innerJoin(schema.productSkus, eq(schema.cartItems.skuId, schema.productSkus.id))
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(eq(schema.cartItems.userId, userId))
    .orderBy(schema.cartItems.createdAt)
  return { items: rows.map(cartItemDetail) }
}

async function getCartItem(
  userId: string,
  skuId: string,
  client: DbClient,
): Promise<CartItemDetail> {
  const [row] = await client
    .select(cartWithDetails)
    .from(schema.cartItems)
    .innerJoin(schema.productSkus, eq(schema.cartItems.skuId, schema.productSkus.id))
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(and(eq(schema.cartItems.userId, userId), eq(schema.cartItems.skuId, skuId)))
  return cartItemDetail(row)
}

export async function updateCartItem(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<CartItemDetail, 'CART_ITEM_NOT_FOUND'>> {
  const [updated] = await client
    .update(schema.cartItems)
    .set({ quantity })
    .where(and(eq(schema.cartItems.userId, userId), eq(schema.cartItems.skuId, skuId)))
    .returning()
  if (!updated) return err('CART_ITEM_NOT_FOUND')
  return ok(await getCartItem(userId, skuId, client))
}

export async function removeCartItem(
  userId: string,
  skuId: string,
  client: DbClient,
): Promise<Result<{ removed: true }, 'CART_ITEM_NOT_FOUND'>> {
  const [removed] = await client
    .delete(schema.cartItems)
    .where(and(eq(schema.cartItems.userId, userId), eq(schema.cartItems.skuId, skuId)))
    .returning()
  if (!removed) return err('CART_ITEM_NOT_FOUND')
  return ok({ removed: true })
}

export async function clearCart(userId: string, client: DbClient): Promise<{ cleared: true }> {
  await client.delete(schema.cartItems).where(eq(schema.cartItems.userId, userId))
  return { cleared: true }
}
