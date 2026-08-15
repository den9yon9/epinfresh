import { type DbClient, withTransaction } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { listPaymentsByOrder, refundPayment } from '@epinfresh/payment'
import { restoreProductStock } from '@epinfresh/product'
import { err, ok, type Result } from '@epinfresh/shared'

export type CancelOrderError = 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'

export async function cancelOrder(
  orderId: string,
  client: DbClient,
): Promise<Result<OrderDetail, CancelOrderError>> {
  return withTransaction(client, async (tx) => {
    const result = await updateOrderStatus(orderId, 'cancelled', tx)
    if (result.isErr()) {
      return err(result.error)
    }
    const { from, order } = result.value
    if (from === 'pending') {
      for (const item of order.items) {
        const restored = await restoreProductStock(item.skuId, item.quantity, tx)
        if (restored.isErr()) {
          throw new Error(`restore stock failed for sku ${item.skuId}`)
        }
      }
    } else if (from === 'paid') {
      const { items: payments } = await listPaymentsByOrder(orderId, tx)
      for (const payment of payments) {
        if (payment.status === 'succeeded') {
          const refunded = await refundPayment(payment.id, tx)
          if (refunded.isErr()) {
            throw new Error(`refund failed for payment ${payment.id}`)
          }
        }
      }
    }
    return ok(order)
  })
}
