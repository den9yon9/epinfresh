import { Type } from '@sinclair/typebox'

// 请求契约(响应视图契约归 usecases/cart-ops, 由域裸行 + product 简报拼装)
export const AddCartItemInputSchema = Type.Object({
  skuId: Type.String({ format: 'uuid' }),
  quantity: Type.Number({ minimum: 1, maximum: 9999 }),
})

export const UpdateCartItemInputSchema = Type.Object({
  quantity: Type.Number({ minimum: 1, maximum: 9999 }),
})
