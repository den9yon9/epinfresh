import { type DbClient, schema } from '@epinfresh/database'
import { createOrderRecord, getOrderById, type OrderDetail } from '@epinfresh/order'
import { getSkusByIds, reduceProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, eq } from 'drizzle-orm'

import type { CreateOrderInputSchema } from './model'

export type CheckoutErrorCode =
  'SKU_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'PRODUCT_UNAVAILABLE' | 'ADDRESS_NOT_FOUND'

class CheckoutError extends Error {
  constructor(readonly code: CheckoutErrorCode) {
    super(code)
  }
}

function isUniqueViolation(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code: string }).code === '23505'
  )
}

export async function checkoutWorkflow(
  input: Static<typeof CreateOrderInputSchema> & { userId: string; idempotencyKey?: string },
  client: DbClient,
): Promise<Result<{ order: OrderDetail; replayed: boolean }, CheckoutErrorCode>> {
  const { userId, idempotencyKey } = input

  if (idempotencyKey) {
    const [existing] = await client
      .select()
      .from(schema.checkoutIdempotencyKeys)
      .where(
        and(
          eq(schema.checkoutIdempotencyKeys.userId, userId),
          eq(schema.checkoutIdempotencyKeys.key, idempotencyKey),
        ),
      )
    if (existing) {
      const order = await getOrderById(existing.orderId, client)
      if (order.isOk()) return ok({ order: order.value, replayed: true })
    }
  }

  try {
    const order = await client.transaction(async (tx) => {
      const merged = new Map<string, number>()
      for (const item of input.items) {
        merged.set(item.skuId, (merged.get(item.skuId) ?? 0) + item.quantity)
      }
      const items = [...merged.entries()].map(([skuId, quantity]) => ({ skuId, quantity }))

      const skuIds = items.map((i) => i.skuId)
      const skus = await getSkusByIds(skuIds, tx)
      const skuMap = new Map(skus.map((s) => [s.id, s]))

      const [address] = await tx
        .select()
        .from(schema.addresses)
        .where(and(eq(schema.addresses.id, input.addressId), eq(schema.addresses.userId, userId)))
      if (!address) throw new CheckoutError('ADDRESS_NOT_FOUND')

      const validated = items.map((item) => {
        const sku = skuMap.get(item.skuId)
        if (!sku) throw new CheckoutError('SKU_NOT_FOUND')
        if (sku.product.status !== 'published') throw new CheckoutError('PRODUCT_UNAVAILABLE')
        return { item, sku }
      })

      for (const { item } of validated) {
        const result = await reduceProductStock(item.skuId, item.quantity, tx)
        if (result.isErr()) throw new CheckoutError(result._unsafeUnwrapErr())
      }

      const lines = validated.map(({ item, sku }) => ({
        skuId: sku.id,
        productName: sku.product.name,
        skuName: sku.name,
        unitPrice: sku.price,
        quantity: item.quantity,
      }))

      const order = await createOrderRecord(tx, userId, lines, {
        addressId: address.id,
        recipientName: address.recipientName,
        phone: address.phone,
        address: address.address,
      })
      if (idempotencyKey) {
        // 故意不用 onConflictDoNothing：冲突必须抛 23505 让本事务回滚（含扣库存），
        // 否则并发同 key 会静默跳过并各自提交重复订单
        await tx
          .insert(schema.checkoutIdempotencyKeys)
          .values({ userId, key: idempotencyKey, orderId: order.id })
      }
      return order
    })
    return ok({ order, replayed: false })
  } catch (caught) {
    if (caught instanceof CheckoutError) return err(caught.code)
    // 并发同 key：唯一约束使后到事务回滚，重查已建订单返回
    if (isUniqueViolation(caught) && idempotencyKey) {
      const [row] = await client
        .select()
        .from(schema.checkoutIdempotencyKeys)
        .where(
          and(
            eq(schema.checkoutIdempotencyKeys.userId, userId),
            eq(schema.checkoutIdempotencyKeys.key, idempotencyKey),
          ),
        )
      if (row) {
        const order = await getOrderById(row.orderId, client)
        if (order.isOk()) return ok({ order: order.value, replayed: true })
      }
    }
    throw caught
  }
}
