import {
  type DbClient,
  ORDER_STATUS,
  type OrderStatus,
  schema,
  withTransaction,
} from '@epinfresh/database'
import { err, fromCents, ok, type Result, toCents } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, count, eq } from 'drizzle-orm'

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

  const [order] = await client
    .insert(schema.orders)
    .values({
      userId,
      status: 'pending',
      totalAmount: fromCents(totalCents),
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

// 发货: 只有 paid 可发货; 已 shipped 时重复调用仅补/更运单号(幂等)。CAS 防并发双发货,
// 状态流转 + 运单号 + shippedAt 在同一事务内原子提交, 不会出现"已发货但无运单号"的半态。
// onShipped 由调用方(app 层)注入(域不依赖 outbox): 仅 paid → shipped 真实转变时在
// 同一事务内回调写 order.shipped 事件; 已 shipped 的运单号补录不触发(不重发邮件)。
export interface OrderShippedEvent {
  orderId: string
  trackingNumber: string | null
  shippedAt: string
}

export interface ShipOrderOptions {
  onShipped?: (client: DbClient, event: OrderShippedEvent) => Promise<void>
}

export async function shipOrder(
  orderId: string,
  trackingNumber: string | undefined,
  client: DbClient,
  opts: ShipOrderOptions = {},
): Promise<Result<OrderDetail, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>> {
  return withTransaction(client, async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    if (!order) return err('ORDER_NOT_FOUND')
    if (order.status !== 'paid' && order.status !== 'shipped') {
      return err('INVALID_TRANSITION')
    }
    const firstShipment = order.status === 'paid'
    const [updated] = await tx
      .update(schema.orders)
      .set({
        status: 'shipped',
        trackingNumber: trackingNumber ?? order.trackingNumber,
        shippedAt: order.shippedAt ?? new Date(),
      })
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, order.status)))
      .returning()
    if (!updated) return err('INVALID_TRANSITION')
    const items = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
    if (firstShipment && opts.onShipped) {
      await opts.onShipped(tx, {
        orderId,
        trackingNumber: updated.trackingNumber,
        // 本事务内刚写入, 运行时必非空; 类型上列可空故兜底
        shippedAt: (updated.shippedAt ?? new Date()).toISOString(),
      })
    }
    return ok({ ...updated, items })
  })
}
