import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { markOrderRefunded, type OrderDetail } from '@epinfresh/order'
import { refundOrder } from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'

export type RefundOrderErrorCode =
  'ORDER_NOT_FOUND' | 'NO_REFUNDABLE_PAYMENT' | 'INVALID_PAYMENT_STATE'

// 编排: 订单退款跨 payment + order 两域, 事务内保持原子。
// 先由 order 域校验订单可退款(paid/shipped/completed, CAS 防重复), 再改支付单 refunded。
// 回调内 return err() 由 withTransaction 转为回滚, 不会提交半套状态。
export async function refundOrderWorkflow(
  orderId: string,
  client: DbClient,
): Promise<
  Result<{ payment: typeof schema.payments.$inferSelect; order: OrderDetail }, RefundOrderErrorCode>
> {
  return withTransaction(client, async (tx) => {
    const orderResult = await markOrderRefunded(orderId, tx)
    if (orderResult.isErr()) {
      return err(
        orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
      )
    }

    const paymentResult = await refundOrder(orderId, tx)
    if (paymentResult.isErr()) return err(paymentResult.error)

    return ok({ payment: paymentResult.value, order: orderResult.value.order })
  })
}
