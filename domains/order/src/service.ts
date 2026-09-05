import { type DbClient, ORDER_STATUS, type OrderStatus, schema } from '@epinfresh/database'
import { err, fromCents, ok, type Result, toCents } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, count, eq, inArray, isNotNull, lt } from 'drizzle-orm'

import type { AdminOrderListQuerySchema, OrderDetailSchema, OrderListQuerySchema } from './model'
export type OrderDetail = Static<typeof OrderDetailSchema>

export interface OrderLineInput {
  skuId: string
  productName: string
  skuName: string
  unitPrice: string
  quantity: number
}

export interface OrderShippingInput {
  addressId: string
  recipientName: string
  phone: string
  address: string
}

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  // refunded 只能走退款专用接口（payment 侧事务联动），不进 PATCH 流转表
  refunded: [],
  cancelled: [],
}

export async function createOrderRecord(
  userId: string,
  lines: OrderLineInput[],
  shipping: OrderShippingInput,
  client: DbClient,
  opts: { shippingFeeCents?: bigint } = {},
): Promise<OrderDetail> {
  let totalCents = 0n
  const rows = lines.map((line) => {
    const unitPriceCents = toCents(line.unitPrice)
    const subtotalCents = unitPriceCents * BigInt(line.quantity)
    totalCents += subtotalCents
    return {
      skuId: line.skuId,
      productName: line.productName,
      skuName: line.skuName,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      subtotal: fromCents(subtotalCents),
    }
  })
  // totalAmount 语义 = 最终应付(商品合计 + 运费); shippingFee 列保存明细供展示/审计
  const shippingFeeCents = opts.shippingFeeCents ?? 0n
  totalCents += shippingFeeCents
  const shippingFee = fromCents(shippingFeeCents)

  const [order] = await client
    .insert(schema.orders)
    .values({
      userId,
      status: 'pending',
      totalAmount: fromCents(totalCents),
      shippingFee,
      addressId: shipping.addressId,
      recipientName: shipping.recipientName,
      recipientPhone: shipping.phone,
      shippingAddress: shipping.address,
    })
    .returning()
  await client.insert(schema.orderItems).values(rows.map((row) => ({ ...row, orderId: order.id })))
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id))
  return { ...order, items }
}

export async function listOrdersByUser(
  userId: string,
  query: Static<typeof OrderListQuerySchema>,
  client: DbClient,
) {
  const { page, pageSize, status } = query
  const offset = (page - 1) * pageSize
  const where = status
    ? and(eq(schema.orders.userId, userId), eq(schema.orders.status, status))
    : eq(schema.orders.userId, userId)
  const items = await client.query.orders.findMany({
    where,
    orderBy: (orders, { desc }) => desc(orders.createdAt),
    limit: pageSize,
    offset,
  })
  const [{ total }] = await client.select({ total: count() }).from(schema.orders).where(where)
  return { items, total: Number(total), page, pageSize }
}

export async function getOrderForUser(
  userId: string,
  orderId: string,
  client: DbClient,
): Promise<Result<OrderDetail, 'ORDER_NOT_FOUND'>> {
  const order = await client.query.orders.findFirst({
    where: and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)),
  })
  if (!order) return err('ORDER_NOT_FOUND')
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id))
    .orderBy(schema.orderItems.createdAt)
  return ok({ ...order, items })
}

// 支付快照: 发起支付所需的订单窄视图(id/状态/金额/币种)。支付编排层先取快照并校验
// 可支付状态, 再把金额/币种交给 payment 域——payment 域无需感知订单表结构。
export interface PayableOrderSnapshot {
  id: string
  status: OrderStatus
  totalAmount: string
  currency: string
}

export async function getPayableOrder(
  orderId: string,
  client: DbClient,
): Promise<Result<PayableOrderSnapshot, 'ORDER_NOT_FOUND'>> {
  const [order] = await client
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      totalAmount: schema.orders.totalAmount,
      currency: schema.orders.currency,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  return ok(order)
}

export async function getOrderById(
  orderId: string,
  client: DbClient,
): Promise<Result<OrderDetail, 'ORDER_NOT_FOUND'>> {
  const order = await client.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
  })
  if (!order) return err('ORDER_NOT_FOUND')
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id))
    .orderBy(schema.orderItems.createdAt)
  return ok({ ...order, items })
}

export async function listOrders(
  query: Static<typeof AdminOrderListQuerySchema>,
  client: DbClient,
) {
  const { page, pageSize, status } = query
  const offset = (page - 1) * pageSize
  const filters: ReturnType<typeof eq>[] = []
  if (status) filters.push(eq(schema.orders.status, status))
  const where = filters.length > 0 ? and(...filters) : undefined
  const items = await client.query.orders.findMany({
    where,
    orderBy: (orders, { desc }) => desc(orders.createdAt),
    limit: pageSize,
    offset,
  })
  const [{ total }] = await client.select({ total: count() }).from(schema.orders).where(where)
  return { items, total: Number(total), page, pageSize }
}

export async function getOrderStatusCounts(client: DbClient): Promise<Record<OrderStatus, number>> {
  const rows = await client
    .select({ status: schema.orders.status, total: count() })
    .from(schema.orders)
    .groupBy(schema.orders.status)
  const counts = Object.fromEntries(ORDER_STATUS.map((s) => [s, 0])) as Record<OrderStatus, number>
  for (const row of rows) counts[row.status] = Number(row.total)
  return counts
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  client: DbClient,
): Promise<
  Result<{ order: OrderDetail; from: OrderStatus }, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (!ORDER_TRANSITIONS[order.status].includes(status)) {
    return err('INVALID_TRANSITION')
  }
  const [updated] = await client
    .update(schema.orders)
    .set({ status })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)))
    .returning()
  if (!updated) return err('INVALID_TRANSITION')
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  return ok({ order: { ...updated, items }, from: order.status })
}

// 退款专用: refunded 不进 PATCH 流转表(见 ORDER_TRANSITIONS 注释), 仅由退款编排链路调用。
// 只有 paid/shipped/completed 的订单可退款, CAS 防并发重复退款。
export async function markOrderRefunded(
  orderId: string,
  client: DbClient,
): Promise<
  Result<{ order: OrderDetail; from: OrderStatus }, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (!['paid', 'shipped', 'completed'].includes(order.status)) {
    return err('INVALID_TRANSITION')
  }
  const [updated] = await client
    .update(schema.orders)
    .set({ status: 'refunded' })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)))
    .returning()
  if (!updated) return err('INVALID_TRANSITION')
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  return ok({ order: { ...updated, items }, from: order.status })
}

// 发货: courierCompany 为承运商标识(logistics 域枚举值)。
// 首次发货时承运商与运单号必须同填或同空——只填其一是不可能被轨迹轮询的"死状态"
// (轮询要求两者齐全), 且静默产生永远无轨迹的订单; 后补语义由"先都空、再都填"表达。
// re-ship(已 shipped)允许部分更新: 补录/改号的修正路径不受校验限制。
// CAS 防并发双发货。事务原语: 不自己开事务, 返回 from(旧状态)供编排层判断真实转变;
// order.shipped 事件由发货用例(usecases/ship-order)在同一事务内固定写入, 域不依赖 outbox。
export interface ShipOrderResult {
  order: OrderDetail
  from: OrderStatus
}

export async function shipOrder(
  orderId: string,
  trackingNumber: string | undefined,
  courierCompany: string | undefined,
  client: DbClient,
): Promise<
  Result<ShipOrderResult, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION' | 'SHIPMENT_INFO_INCOMPLETE'>
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (order.status !== 'paid' && order.status !== 'shipped') {
    return err('INVALID_TRANSITION')
  }
  const firstShipment = order.status === 'paid'
  if (firstShipment) {
    const hasCompany = courierCompany !== undefined && courierCompany !== ''
    const hasTracking = trackingNumber !== undefined && trackingNumber !== ''
    if (hasCompany !== hasTracking) return err('SHIPMENT_INFO_INCOMPLETE')
  }
  const [updated] = await client
    .update(schema.orders)
    .set({
      status: 'shipped',
      trackingNumber: trackingNumber ?? order.trackingNumber,
      courierCompany: courierCompany ?? order.courierCompany,
      shippedAt: order.shippedAt ?? new Date(),
    })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)))
    .returning()
  if (!updated) return err('INVALID_TRANSITION')
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  return ok({ order: { ...updated, items }, from: order.status })
}

// 确认收货/标记完成: CAS shipped → completed, 同语句写 completedAt。
// 用户确认、admin 手动完成、超时自动完成三条路径共用, 并发竞态由 CAS 兜底先到先得。
export async function completeOrder(
  orderId: string,
  client: DbClient,
): Promise<Result<OrderDetail, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>> {
  const [updated] = await client
    .update(schema.orders)
    .set({ status: 'completed', completedAt: new Date() })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, 'shipped')))
    .returning()
  if (!updated) {
    // 区分不存在与非法流转, 供路由层映射 404/409
    const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    if (!order) return err('ORDER_NOT_FOUND')
    return err('INVALID_TRANSITION')
  }
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  return ok({ ...updated, items })
}

// 超时自动完成: 批量把发货超过 olderThan 的 shipped 订单 CAS 置 completed。// 先圈定目标(limit), 再带 status='shipped' 守卫的 CAS 批量更新——两步之间的
// 状态变化(如用户恰好确认)由 CAS 过滤, 不会误伤。返回实际完成数供 worker 记录。
export const ORDER_AUTO_COMPLETE_BATCH_SIZE = 200

export async function autoCompleteShippedOrders(
  olderThan: Date,
  client: DbClient,
  limit = ORDER_AUTO_COMPLETE_BATCH_SIZE,
  excludeOrderIds: string[] = [],
): Promise<number> {
  const stale = await client
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, 'shipped'), lt(schema.orders.shippedAt, olderThan)))
    .orderBy(schema.orders.shippedAt)
    .limit(limit)
  // excludeOrderIds: 收尾异常订单(拒收/派送失败, logistics 域查询后传入)——
  // 拒收单被自动完成等于钱货两空, 必须排除
  const candidates = stale.filter((row) => !excludeOrderIds.includes(row.id))
  if (candidates.length === 0) return 0
  const rows = await client
    .update(schema.orders)
    .set({ status: 'completed', completedAt: new Date() })
    .where(
      and(
        eq(schema.orders.status, 'shipped'),
        inArray(
          schema.orders.id,
          candidates.map((row) => row.id),
        ),
      ),
    )
    .returning({ id: schema.orders.id })
  return rows.length
}

// 物流轮询入口: 已发货且指定了承运商与运单号的订单(轨迹可查)。
// 供 logistics-sync 用例消费——域间禁止互调, 编排发生在 usecases。
export async function listShippedWithTracking(
  client: DbClient,
  limit = 100,
): Promise<{ id: string; courierCompany: string; trackingNumber: string; shippedAt: Date }[]> {
  const rows = await client
    .select({
      id: schema.orders.id,
      courierCompany: schema.orders.courierCompany,
      trackingNumber: schema.orders.trackingNumber,
      shippedAt: schema.orders.shippedAt,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'shipped'),
        isNotNull(schema.orders.courierCompany),
        isNotNull(schema.orders.trackingNumber),
        isNotNull(schema.orders.shippedAt),
      ),
    )
    .orderBy(schema.orders.shippedAt)
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    courierCompany: row.courierCompany as string,
    trackingNumber: row.trackingNumber as string,
    shippedAt: row.shippedAt as Date,
  }))
}

// 超时未支付订单批处理上限
export const ORDER_AUTO_CANCEL_BATCH_SIZE = 200

// 超时未支付订单扫描: 圈定创建时间早于 olderThan 且仍处于 pending 状态的订单
export async function listStalePendingOrders(
  olderThan: Date,
  client: DbClient,
  limit = ORDER_AUTO_CANCEL_BATCH_SIZE,
): Promise<{ id: string }[]> {
  return client
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, 'pending'), lt(schema.orders.createdAt, olderThan)))
    .orderBy(schema.orders.createdAt)
    .limit(limit)
}
