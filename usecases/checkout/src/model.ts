import { ErrorResponse } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

export const CreateOrderInputSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      skuId: Type.String({ format: 'uuid' }),
      quantity: Type.Number({ minimum: 1, maximum: 9999 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
  addressId: Type.String({ format: 'uuid' }),
})

export const CheckoutConflictResponseSchema = Type.Object({
  error: Type.Literal('INSUFFICIENT_STOCK'),
  message: Type.String(),
  skuId: Type.String(),
  available: Type.Number(),
})

// 409 承载两个错误形态: PRODUCT_UNAVAILABLE(无 payload) 与 INSUFFICIENT_STOCK(带 payload)
export const CheckoutErrorResponseSchema = Type.Union([
  ErrorResponse,
  CheckoutConflictResponseSchema,
])
