import type { api } from './client'
import type { EdenApiBody, EdenApiData, EdenBody, EdenData, EdenListItem } from './eden-types'

export type AdminUser = EdenData<typeof api.auth.me.get>
export type Dashboard = EdenData<typeof api.admin.dashboard.get>
export type Order = EdenListItem<typeof api.admin.orders.get>

// treaty 动态段子路径: 带参调用返回该段的方法对象（含子路径 status/ship/refund/payments）
type ParamsResult<T> = T extends (params: { id: string | number }) => infer R ? R : never
type OrderDetailSub = ParamsResult<typeof api.admin.orders>

export type OrderDetail = EdenApiData<OrderDetailSub['get']>
export type Payment = EdenApiData<OrderDetailSub['payments']['get']>['items'][number]
export type ShipOrderBody = EdenApiBody<OrderDetailSub['ship']['post']>
// ponytail: status.patch 的 body 类型在 eden 视图里坍缩为 never(admin-api 测试同款 workaround),
// 页面调用时按需 `as never`; 后端仍会按 UpdateOrderStatusSchema 校验
// 上游: elysia 2.0 发布后验证 eden next 分支是否修复, 见 CONTRIBUTE.md「上游依赖待验证」

export type Product = EdenListItem<typeof api.admin.products.get>
export type ProductStatus = Product['status']
export type Category = EdenListItem<typeof api.admin.categories.get>
export type CategoryBody = EdenBody<typeof api.admin.categories.post>
export type User = EdenListItem<typeof api.admin.users.get>
export type CreateProductBody = EdenBody<typeof api.admin.products.post>
export type UpdateProductBody = EdenApiBody<ParamsResult<typeof api.admin.products>['put']>
export type ProductDetail = EdenApiData<ParamsResult<typeof api.admin.products>['get']>
