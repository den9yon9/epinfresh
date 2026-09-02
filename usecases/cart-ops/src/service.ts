import {
  type CartError,
  type CartItemRow,
  listCartItems,
  updateCartItem,
  upsertCartItem,
} from '@epinfresh/cart'
import { type DbClient } from '@epinfresh/database'
import { getSkuPurchaseInfo, getSkuViewsByIds } from '@epinfresh/product'
import { err, InvariantViolation, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'

import { type CartItemResponseSchema } from './model'

export type CartItemView = Static<typeof CartItemResponseSchema>

export type AddToCartError = 'SKU_NOT_FOUND' | 'PRODUCT_UNAVAILABLE'

// 编排: 加购跨 product(可购性校验) + cart(行写入)两域。
// 校验经 product 域轻量快照(getSkuPurchaseInfo), 写入/合并/上限归 cart 域。
export async function addItemToCart(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<CartItemView, AddToCartError>> {
  const info = await getSkuPurchaseInfo(skuId, client)
  if (info.isErr()) return err('SKU_NOT_FOUND')
  if (info.value.productStatus !== 'published') return err('PRODUCT_UNAVAILABLE')

  const row = await upsertCartItem(userId, skuId, quantity, client)
  return ok(await assembleView(client, row))
}

// 读模型: cart 域裸行 + product 域 SKU/商品简报, 内存拼装(批量取, 防 N+1)。
// cartItems.sku_id 外键 restrict 保证 SKU 必存在, 与拆分前 innerJoin 行为一致。
export async function viewCart(
  userId: string,
  client: DbClient,
): Promise<{
  items: CartItemView[]
}> {
  const { items } = await listCartItems(userId, client)
  return { items: await assembleViews(client, items) }
}

export async function changeCartItemQuantity(
  userId: string,
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<CartItemView, CartError>> {
  const updated = await updateCartItem(userId, skuId, quantity, client)
  if (updated.isErr()) return err(updated.error)
  return ok(await assembleView(client, updated.value))
}

async function assembleViews(client: DbClient, rows: CartItemRow[]): Promise<CartItemView[]> {
  if (rows.length === 0) return []
  const views = await getSkuViewsByIds(
    rows.map((row) => row.skuId),
    client,
  )
  const bySkuId = new Map(views.map((view) => [view.skuId, view]))
  const out: CartItemView[] = []
  for (const row of rows) {
    const view = bySkuId.get(row.skuId)
    if (!view) continue
    out.push(toCartItemView(row, view))
  }
  return out
}

async function assembleView(client: DbClient, row: CartItemRow): Promise<CartItemView> {
  const [view] = await assembleViews(client, [row])
  // cartItems.sku_id 外键 restrict 保证 SKU 存在, 视图缺失属数据不一致
  if (!view) {
    throw new InvariantViolation('cart view assembly: sku view missing', {
      cause: { skuId: row.skuId },
    })
  }
  return view
}

function toCartItemView(
  row: CartItemRow,
  view: Awaited<ReturnType<typeof getSkuViewsByIds>>[number],
) {
  return {
    id: row.id,
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sku: {
      id: view.skuId,
      name: view.name,
      skuCode: view.skuCode,
      price: view.price,
      stock: view.stock,
      attributes: view.attributes,
    },
    product: {
      id: view.productId,
      name: view.productName,
      slug: view.slug,
      images: view.images,
      status: view.productStatus,
    },
  }
}
