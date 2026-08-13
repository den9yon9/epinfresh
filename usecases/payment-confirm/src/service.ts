import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { confirmPayment } from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'

export type ConfirmPaymentError =
  { code: 'PAYMENT_NOT_FOUND' } | { code: 'INVALID_PAYMENT_STATE' } | { code: 'ORDER_NOT_FOUND' }

// 编排: 支付确认跨 payment + order 两域, 事务内保持原子。
// payment 域只改支付单; 订单 pending→paid 由 order 域状态机推进(CAS 防并发)。
// 回调内 return err() 由 withTransaction 转为回滚: 订单非 pending(已被取消等)时
// 整个事务回滚, 支付单不会落 succeeded。
export async function confirmOrderPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<{ payment: typeof schema.payments.$inferSelect; order: OrderDetail }, ConfirmPaymentError>
> {
  return withTransaction(client, async (tx) => {
    const paymentResult = await confirmPayment(paymentId, tx)
    if (paymentResult.isErr()) return err(paymentResult.error)
    const { payment, orderId } = paymentResult.value

    const orderResult = await updateOrderStatus(orderId, 'paid', tx)
    if (orderResult.isErr()) {
      return err(
        orderResult.error.code === 'ORDER_NOT_FOUND'
          ? ({ code: 'ORDER_NOT_FOUND' } as const)
          : ({ code: 'INVALID_PAYMENT_STATE' } as const),
      )
    }
    return ok({ payment, order: orderResult.value.order })
  })
}
