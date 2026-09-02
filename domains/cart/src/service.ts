import { type DbClient, schema } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'

// 域只操作 cartItems 表: 商品校验与展示拼装归编排层(usecases/cart)。
// 跨域读约束见 eslint-rules/cross-domain-read。
export type CartError = 'CART_ITEM_NOT_FOUND'

export interface CartItemRow {
  id: string
  skuId: string
  quantity: number
  createdAt: Date
  updatedAt: Date
}

// 加购/合并数量: 同 (userId, skuId) 累加, 单项上限 9999。
// 可购性校验由编排层先行, 域内无跨域读。
export async function upsertCartItem(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<CartItemRow> {
  const [row] = await client
    .insert(schema.cartItems)
    .values({ userId, skuId, quantity })
    .onConflictDoUpdate({
      target: [schema.cartItems.userId, schema.cartItems.skuId],
      set: { quantity: sql`LEAST(${schema.cartItems.quantity} + excluded.quantity, 9999)` },
    })
    .returning()
  return row
}

export async function listCartItems(
  userId: string,
  client: DbClient,
): Promise<{ items: CartItemRow[] }> {
  const items = await client
    .select()
    .from(schema.cartItems)
    .where(eq(schema.cartItems.userId, userId))
    .orderBy(schema.cartItems.createdAt)
  return { items }
}

export async function updateCartItem(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<CartItemRow, CartError>> {
  const [updated] = await client
    .update(schema.cartItems)
    .set({ quantity })
    .where(and(eq(schema.cartItems.userId, userId), eq(schema.cartItems.skuId, skuId)))
    .returning()
  if (!updated) return err('CART_ITEM_NOT_FOUND')
  return ok(updated)
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

// 批量移除指定 SKU 的购物车项(结算后清理用); 语义同 clearCart: 不关心行是否存在, 无错误分支。
// 调用方只需传入结算涉及的 skuIds, 未在购物车中的 SKU 静默忽略。
export async function removeCartItems(
  userId: string,
  skuIds: string[],
  client: DbClient,
): Promise<{ removed: true }> {
  await client
    .delete(schema.cartItems)
    .where(and(eq(schema.cartItems.userId, userId), inArray(schema.cartItems.skuId, skuIds)))
  return { removed: true }
}
