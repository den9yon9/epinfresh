import { type DbClient } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { restoreProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'

export type CancelOrderErrorCode = 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'

export async function cancelOrder(
  orderId: string,
  client: DbClient,
): Promise<Result<OrderDetail, CancelOrderErrorCode>> {
  return client.transaction(async (tx) => {
    const result = await updateOrderStatus(orderId, 'cancelled', tx)
    if (result.isErr()) {
      return err(result._unsafeUnwrapErr())
    }
    const { from, order } = result.value
    if (from === 'pending') {
      for (const item of order.items) {
        const restored = await restoreProductStock(item.skuId, item.quantity, tx)
        if (restored.isErr()) {
          throw new Error(`restore stock failed for sku ${item.skuId}`)
        }
      }
    }
    return ok(order)
  })
}
