import { ORDER_STATUS, table } from '@epinfresh/database'
import { PaginatedResponse, PaginationQuery } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

const statusLiteral = Type.Union(ORDER_STATUS.map((s) => Type.Literal(s)))

export const CreateOrderInputSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      skuId: Type.String({ format: 'uuid' }),
      quantity: Type.Number({ minimum: 1, maximum: 9999 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
})

const OrderDetailSchema = Type.Intersect([
  table.select.order,
  Type.Object({ items: Type.Array(table.select.orderItem) }),
])

export { OrderDetailSchema }
export const OrderResponseSchema = OrderDetailSchema
export const OrderListResponseSchema = PaginatedResponse(table.select.order)
export const OrderListQuerySchema = PaginationQuery
export const AdminOrderListQuerySchema = Type.Composite([
  PaginationQuery,
  Type.Object({ status: Type.Optional(statusLiteral) }),
])
export const UpdateOrderStatusSchema = Type.Object({ status: statusLiteral })
