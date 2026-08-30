// 表定义按域分目录; 目录名即表归属域(eslint-rules/table-ownership.js 据此推导)。
// 新增表: 放到对应域目录 + 在此补一行导出即可, 归属自动成立。
// 顶层导出仍保持扁平命名(所有表聚合在 schema 命名空间), 使用方无感知。

// address 域
export { addresses } from './address/addresses'
// cart 域
export { cartItems } from './cart/cart-items'
// checkout 编排(usecase 层, 不归某 domain)
export { checkoutIdempotencyKeys } from './checkout/checkout-idempotency-keys'
// order 域
export { orderItems } from './order/order-items'
// logistics 域(轨迹快照, worker 轮询承运商拉取)
export {
  LOGISTICS_TRACK_STATUS,
  logisticsTracks,
  type LogisticsTrackStatus,
  logisticsTrackStatus,
} from './logistics/logistics-tracks'
// outbox 域(领域事件持久化, 事务内写入, worker 异步投递)
export { ORDER_STATUS, orders, type OrderStatus, orderStatus } from './order/orders'
export {
  OUTBOX_EVENT_STATUS,
  outboxEvents,
  type OutboxEventStatus,
  outboxEventStatus,
} from './outbox/outbox-events'
// payment 域
export { PAYMENT_STATUS, payments, type PaymentStatus, paymentStatus } from './payment/payments'
export { REFUND_STATUS, refunds, type RefundStatus, refundStatus } from './payment/refunds'
// product 域
export { categories } from './product/categories'
export { productSkus } from './product/product-skus'
export { products, productStatus } from './product/products'
// user 域
export {
  addressesRelations,
  cartItemsRelations,
  categoriesRelations,
  checkoutIdempotencyKeysRelations,
  orderItemsRelations,
  ordersRelations,
  paymentsRelations,
  productSkusRelations,
  productsRelations,
  usersRelations,
} from './relations'
export { passwordResetTokens } from './user/password-reset-tokens'
export { userRole, users } from './user/users'
