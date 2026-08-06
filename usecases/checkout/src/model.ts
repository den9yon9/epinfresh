import { Type } from '@sinclair/typebox'

export const CreateOrderInputSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      skuId: Type.String({ format: 'uuid' }),
      quantity: Type.Number({ minimum: 1, maximum: 9999 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
})
