import { table } from '@epinfresh/database'
import { Type } from '@sinclair/typebox'

export const PaymentResponseSchema = table.select.payment

export const PaymentListResponseSchema = Type.Object({
  items: Type.Array(table.select.payment),
})
