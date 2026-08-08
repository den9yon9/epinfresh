import { type DbClient, type OrderStatus, schema } from '@epinfresh/database'
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
  cancelled: [],
}

export async function createOrderRecord(
  client: DbClient,
  userId: string,
  lines: OrderLineInput[],
  shipping: OrderShippingInput,
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
  const { page, pageSize } = query
  const offset = (page - 1) * pageSize
  const items = await client.query.orders.findMany({
    where: eq(schema.orders.userId, userId),
    orderBy: (orders, { desc }) => desc(orders.createdAt),
    limit: pageSize,
    offset,
  })
  const [{ total }] = await client
    .select({ total: count() })
    .from(schema.orders)
    .where(eq(schema.orders.userId, userId))
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

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  client: DbClient,
): Promise<
  Result<{ order: OrderDetail; from: OrderStatus }, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>
> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (!ORDER_TRANSITIONS[order.status].includes(status)) return err('INVALID_TRANSITION')
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
