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
export const OrderListQuerySchema = Type.Composite([
  PaginationQuery,
  Type.Object({ status: Type.Optional(statusLiteral) }),
])
export const AdminOrderListQuerySchema = Type.Composite([
  PaginationQuery,
  Type.Object({ status: Type.Optional(statusLiteral) }),
])
export const UpdateOrderStatusSchema = Type.Object({ status: patchableStatusLiteral })

// 运费预览(结算页展示用): 元字符串; threshold null = 不启用包邮
export const ShippingFeePreviewSchema = Type.Object({
  flatFee: Type.String(),
  freeShippingThreshold: Type.Union([Type.String(), Type.Null()]),
  remoteFee: Type.String(),
  remoteProvinces: Type.Array(Type.String()),
  weightBaseGrams: Type.Number(),
  weightAdditionalGrams: Type.Number(),
  weightAdditionalFee: Type.String(),
})

export const LowStockSkuSchema = Type.Object({
  skuId: Type.String({
    format: 'uuid',
  }),
  skuName: Type.String(),
  productId: Type.String({
    format: 'uuid',
  }),
  productName: Type.String(),
  stock: Type.Number(),
})

export const TopProductResponseSchema = Type.Object({
  productName: Type.String(),
  quantity: Type.Number(),
})

export const DashboardResponseSchema = Type.Object({
  todayGmv: Type.String(),
  totalGmv: Type.String(),
  todayOrders: Type.Number(),
  totalOrders: Type.Number(),
  totalUsers: Type.Number(),
  orderCounts: Type.Object(
    Object.fromEntries(ORDER_STATUS.map((s) => [s, Type.Number()])) as Record<
      (typeof ORDER_STATUS)[number],
      ReturnType<typeof Type.Number>
    >,
  ),
  lowStock: Type.Array(LowStockSkuSchema),
  topProducts: Type.Array(TopProductResponseSchema),
})
