import { ORDER_STATUS, table } from '@epinfresh/database'
import { PaginatedResponse, PaginationQuery } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

const statusLiteral = Type.Union(ORDER_STATUS.map((s) => Type.Literal(s)))
// refunded 只能走退款专用接口（payment 侧事务联动），不允许 PATCH 手动置
const patchableStatusLiteral = Type.Union(
  ORDER_STATUS.filter((s) => s !== 'refunded').map((s) => Type.Literal(s)),
)

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
export const UpdateOrderStatusSchema = Type.Object({ status: patchableStatusLiteral })

export const DashboardResponseSchema = Type.Object(
  Object.fromEntries(ORDER_STATUS.map((s) => [s, Type.Number()])) as Record<
    (typeof ORDER_STATUS)[number],
    ReturnType<typeof Type.Number>
  >,
)
