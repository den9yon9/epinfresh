import { Type } from '@sinclair/typebox'

// 购物车响应视图: 域裸行(cartItems 表) + product 域 SKU/商品简报, 由本用例拼装。
// 契约形状与拆分前完全一致, 前端(eden treaty 派生类型)零改动。
const SkuBriefSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  skuCode: Type.String(),
  price: Type.String(),
  stock: Type.Number(),
  attributes: Type.Record(Type.String(), Type.String()),
})

const ProductBriefSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  images: Type.Array(Type.String()),
  status: Type.String(),
})

export const CartItemResponseSchema = Type.Intersect([
  Type.Object({
    id: Type.String(),
    quantity: Type.Number(),
    createdAt: Type.Date(),
    updatedAt: Type.Date(),
  }),
  Type.Object({
    sku: SkuBriefSchema,
    product: ProductBriefSchema,
  }),
])

export const CartListResponseSchema = Type.Object({
  items: Type.Array(CartItemResponseSchema),
})
