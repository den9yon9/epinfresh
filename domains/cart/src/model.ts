import { table } from '@epinfresh/database'
import { Type } from '@sinclair/typebox'

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
  Type.Pick(table.select.cartItem, ['id', 'quantity', 'createdAt', 'updatedAt']),
  Type.Object({
    sku: SkuBriefSchema,
    product: ProductBriefSchema,
  }),
])

export const CartListResponseSchema = Type.Object({
  items: Type.Array(CartItemResponseSchema),
})

export const AddCartItemInputSchema = Type.Object({
  skuId: Type.String({ format: 'uuid' }),
  quantity: Type.Number({ minimum: 1, maximum: 9999 }),
})

export const UpdateCartItemInputSchema = Type.Object({
  quantity: Type.Number({ minimum: 1, maximum: 9999 }),
})
