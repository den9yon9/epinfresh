import { type DbClient, schema } from '@epinfresh/database'
import { type OrderDetail, updateOrderStatus } from '@epinfresh/order'
import { confirmPayment } from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'

export type ConfirmPaymentErrorCode =
  'PAYMENT_NOT_FOUND' | 'INVALID_PAYMENT_STATE' | 'ORDER_NOT_FOUND'

class ConfirmError extends Error {
  constructor(readonly code: ConfirmPaymentErrorCode) {
    super(code)
  }
}

// 编排: 支付确认跨 payment + order 两域, 事务内保持原子。
// payment 域只改支付单; 订单 pending→paid 由 order 域状态机推进(CAS 防并发)。
// 注意: drizzle 事务只有回调抛异常才回滚, 不能返回 Result 的 err(会被当正常结果提交)。
export async function confirmOrderPayment(
  paymentId: string,
  client: DbClient,
): Promise<
  Result<
    { payment: typeof schema.payments.$inferSelect; order: OrderDetail },
    ConfirmPaymentErrorCode
  >
> {
  try {
    const value = await client.transaction(async (tx) => {
      const paymentResult = await confirmPayment(paymentId, tx)
      if (paymentResult.isErr()) throw new ConfirmError(paymentResult.error)
      const { payment, orderId } = paymentResult.value

      const orderResult = await updateOrderStatus(orderId, 'paid', tx)
      if (orderResult.isErr()) {
        // 订单非 pending(已被取消等)时回滚整个事务, 支付单不会落 succeeded
        throw new ConfirmError(
          orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
        )
      }
      return { payment, order: orderResult.value.order }
    })
    return ok(value)
  } catch (caught) {
    if (caught instanceof ConfirmError) return err(caught.code)
    throw caught
  }
}
