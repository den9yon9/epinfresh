import { createHash } from 'node:crypto'

import { addressText, getAddressById } from '@epinfresh/address'
import { removeCartItems } from '@epinfresh/cart'
import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { createOrderRecord, getOrderById, type OrderDetail } from '@epinfresh/order'
import { getSkusByIds, type InsufficientStockError, reduceProductStock } from '@epinfresh/product'
import { err, ok, type Result, toCents } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, eq, lt } from 'drizzle-orm'

import { computeShippingFee, type ShippingFeeConfig } from './fee'
import type { CreateOrderInputSchema } from './model'

export type CheckoutError =
  | 'SKU_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  | 'ADDRESS_NOT_FOUND'
  | 'BODY_MISMATCH'
  | InsufficientStockError

export interface CheckoutOptions {
  // 运费策略由 app 层从 env 组装注入; 不传 = 零运费(向后兼容, 测试便捷)
  shippingFeeConfig?: ShippingFeeConfig
}

// 幂等键请求体摘要: 商品按 skuId 排序 + 地址, 规范化序列化后 sha256。
// 同 key 不同 body 的重放必须拒绝(前端已重生成 key, 此处兜底防漂移路径)。
export function buildBodyHash(input: {
  addressId: string
  items: { skuId: string; quantity: number }[]
}): string {
  const normalized = {
    addressId: input.addressId,
    items: [...input.items]
      .sort((a, b) => a.skuId.localeCompare(b.skuId))
      .map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function isUniqueViolation(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code: string }).code === '23505'
  )
}

export async function checkout(
  input: Static<typeof CreateOrderInputSchema> & { userId: string; idempotencyKey?: string },
  client: DbClient,
  opts: CheckoutOptions = {},
): Promise<Result<{ order: OrderDetail; replayed: boolean }, CheckoutError>> {
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
      // 同 key 不同 body: 用户意图已变, 拒绝重放而非返回旧订单(防漂移)
      if (existing.bodyHash !== buildBodyHash(input)) return err('BODY_MISMATCH')
      const order = await getOrderById(existing.orderId, client)
      if (order.isOk()) return ok({ order: order.value, replayed: true })
    }
  }

  try {
    const result = await withTransaction(
      client,
      async (tx): Promise<Result<OrderDetail, CheckoutError>> => {
        const merged = new Map<string, number>()
        for (const item of input.items) {
          merged.set(item.skuId, (merged.get(item.skuId) ?? 0) + item.quantity)
        }
        const items = [...merged.entries()].map(([skuId, quantity]) => ({ skuId, quantity }))

        const skuIds = items.map((i) => i.skuId)
        const skus = await getSkusByIds(skuIds, tx)
        const skuMap = new Map(skus.map((s) => [s.id, s]))

        const addressResult = await getAddressById(userId, input.addressId, tx)
        if (addressResult.isErr()) return err(addressResult.error)
        const address = addressResult.value

        const validated: { item: (typeof items)[number]; sku: (typeof skus)[number] }[] = []
        for (const item of items) {
          const sku = skuMap.get(item.skuId)
          if (!sku) return err('SKU_NOT_FOUND')
          if (sku.product.status !== 'published') return err('PRODUCT_UNAVAILABLE')
          validated.push({ item, sku })
        }

        for (const { item } of validated) {
          const result = await reduceProductStock(item.skuId, item.quantity, tx)
          if (result.isErr()) return err(result.error)
        }

        const lines = validated.map(({ item, sku }) => ({
          skuId: sku.id,
          productName: sku.product.name,
          skuName: sku.name,
          unitPrice: sku.price,
          quantity: item.quantity,
        }))

        // 运费: 满额包邮(非偏远) + 偏远加价 + 首重/续重(按 SKU 克重累计); 未注入策略 = 零运费
        const goodsCents = validated.reduce(
          (sum, { item, sku }) => sum + toCents(sku.price) * BigInt(item.quantity),
          0n,
        )
        const totalWeightGrams = validated.reduce(
          (sum, { item, sku }) => sum + (sku.weightGrams ?? 0) * item.quantity,
          0,
        )
        const shippingFeeCents = opts.shippingFeeConfig
          ? computeShippingFee(
              {
                goodsCents,
                totalWeightGrams,
                province: address.province,
              },
              opts.shippingFeeConfig,
            )
          : 0n

        const order = await createOrderRecord(
          userId,
          lines,
          {
            addressId: address.id,
            recipientName: address.recipientName,
            phone: address.phone,
            address: addressText(address),
            province: address.province,
            city: address.city,
            district: address.district,
          },
          tx,
          { shippingFeeCents },
        )
        // 只清结算涉及的 SKU: 契约允许按 SKU 直接结算, 整车清空会误删未结算商品
        await removeCartItems(userId, skuIds, tx)
        if (idempotencyKey) {
          // 故意不用 onConflictDoNothing：冲突必须抛 23505 让本事务回滚（含扣库存），
          // 否则并发同 key 会静默跳过并各自提交重复订单
          await tx.insert(schema.checkoutIdempotencyKeys).values({
            userId,
            key: idempotencyKey,
            orderId: order.id,
            bodyHash: buildBodyHash(input),
          })
        }
        return ok(order)
      },
    )
    if (result.isErr()) return err(result.error)
    return ok({ order: result.value, replayed: false })
  } catch (caught) {
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

// 幂等键只增不删, 定期清理过期行(worker repeatable job 调用)。
// 返回删除行数; 无错误分支, 与 clearCart/removeCartItems 的简单语义一致。
export async function pruneIdempotencyKeys(
  client: DbClient,
  olderThan: Date,
): Promise<{ pruned: number }> {
  const rows = await client
    .delete(schema.checkoutIdempotencyKeys)
    .where(lt(schema.checkoutIdempotencyKeys.createdAt, olderThan))
    .returning({ id: schema.checkoutIdempotencyKeys.id })
  return { pruned: rows.length }
}
