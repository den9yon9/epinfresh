import { Type } from '@sinclair/typebox'

export const CheckoutInputSchema = Type.Object({
  skuId: Type.String({ format: 'uuid' }),
  quantity: Type.Number({ minimum: 1, maximum: 9999 }),
})
