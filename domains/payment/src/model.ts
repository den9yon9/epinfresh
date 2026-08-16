import { table } from '@epinfresh/database'
import { Type } from '@sinclair/typebox'

import { PaymentPayloadSchema } from './gateway'

export const PaymentResponseSchema = Type.Composite([
  Type.Omit(table.select.payment, ['payload']),
  Type.Object({ payload: Type.Optional(Type.Union([PaymentPayloadSchema, Type.Null()])) }),
])

export const PaymentInitiateResponseSchema = Type.Object({
  payment: PaymentResponseSchema,
  payload: PaymentPayloadSchema,
})

export const PaymentListResponseSchema = Type.Object({
  items: Type.Array(PaymentResponseSchema),
})
