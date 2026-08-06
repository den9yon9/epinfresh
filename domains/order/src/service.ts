import { type DbClient, type OrderStatus, schema } from '@epinfresh/database'
import { reduceProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, count, eq, inArray } from 'drizzle-orm'

import type {
  AdminOrderListQuerySchema,
  CreateOrderInputSchema,
  OrderDetailSchema,
  OrderListQuerySchema,
} from './model'

export type OrderDetail = Static<typeof OrderDetailSchema>

type CreateOrderErrorCode = 'SKU_NOT_FOUND' | 'INSUFFICIENT_STOCK'

class CreateOrderError extends Error {
  constructor(readonly code: CreateOrderErrorCode) {
    super(code)
  }
}

function toCents(amount: string): bigint {
  const s = String(amount)
  const dot = s.indexOf('.')
  if (dot === -1) return BigInt(s) * 100n
  const int = s.slice(0, dot)
  const frac = (s.slice(dot + 1) + '00').slice(0, 2)
  return BigInt(int || '0') * 100n + BigInt(frac)
}

function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
}

export async function createOrder(
  input: Static<typeof CreateOrderInputSchema> & { userId: string },
  client: DbClient,
): Promise<Result<OrderDetail, CreateOrderErrorCode>> {
  try {
    const order = await client.transaction(async (tx) => {
      const skuIds = [...new Set(input.items.map((i) => i.skuId))]
      const skus = await tx.query.productSkus.findMany({
        where: inArray(schema.productSkus.id, skuIds),
        with: { product: true },
      })
      const skuMap = new Map(skus.map((s) => [s.id, s]))

      for (const item of input.items) {
        const result = await reduceProductStock(item.skuId, item.quantity, tx)
        if (result.isErr()) throw new CreateOrderError(result._unsafeUnwrapErr())
      }

      let totalCents = 0n
      const lines = input.items.map((item) => {
        const sku = skuMap.get(item.skuId)!
        const unitPriceCents = toCents(sku.price)
        const subtotalCents = unitPriceCents * BigInt(item.quantity)
        totalCents += subtotalCents
        return {
          skuId: sku.id,
          productName: sku.product.name,
          skuName: sku.name,
          unitPrice: sku.price,
          quantity: item.quantity,
          subtotal: fromCents(subtotalCents),
        }
      })

      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId: input.userId,
          status: 'pending',
          totalAmount: fromCents(totalCents),
        })
        .returning()
      await tx
        .insert(schema.orderItems)
        .values(lines.map((line) => ({ ...line, orderId: order.id })))
      const items = await tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
      return { ...order, items }
    })
    return ok(order)
  } catch (caught) {
    if (caught instanceof CreateOrderError) return err(caught.code)
    throw caught
  }
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
): Promise<Result<OrderDetail, 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'>> {
  const [order] = await client.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  if (!order) return err('ORDER_NOT_FOUND')
  if (!ORDER_TRANSITIONS[order.status].includes(status)) return err('INVALID_TRANSITION')
  const [updated] = await client
    .update(schema.orders)
    .set({ status })
    .where(eq(schema.orders.id, orderId))
    .returning()
  const items = await client
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  return ok({ ...updated, items })
}
