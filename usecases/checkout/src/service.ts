import { type DbClient } from '@epinfresh/database'
import { createOrderRecord, type OrderDetail } from '@epinfresh/order'
import { getSkusByIds, reduceProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'

import type { CreateOrderInputSchema } from './model'

export type CheckoutErrorCode = 'SKU_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'PRODUCT_UNAVAILABLE'

class CheckoutError extends Error {
  constructor(readonly code: CheckoutErrorCode) {
    super(code)
  }
}

export async function checkoutWorkflow(
  input: Static<typeof CreateOrderInputSchema> & { userId: string },
  client: DbClient,
): Promise<Result<OrderDetail, CheckoutErrorCode>> {
  try {
    const order = await client.transaction(async (tx) => {
      const skuIds = [...new Set(input.items.map((i) => i.skuId))]
      const skus = await getSkusByIds(skuIds, tx)
      const skuMap = new Map(skus.map((s) => [s.id, s]))

      const validated = input.items.map((item) => {
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

      return createOrderRecord(tx, input.userId, lines)
    })
    return ok(order)
  } catch (caught) {
    if (caught instanceof CheckoutError) return err(caught.code)
    throw caught
  }
}
