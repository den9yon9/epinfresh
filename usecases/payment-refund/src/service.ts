import { type DbClient, schema } from '@epinfresh/database'
import { markOrderRefunded, type OrderDetail } from '@epinfresh/order'
import { refundOrder } from '@epinfresh/payment'
import { err, ok, type Result } from '@epinfresh/shared'

export type RefundOrderErrorCode =
  'ORDER_NOT_FOUND' | 'NO_REFUNDABLE_PAYMENT' | 'INVALID_PAYMENT_STATE'

class RefundError extends Error {
  constructor(readonly code: RefundOrderErrorCode) {
    super(code)
  }
}

// 编排: 订单退款跨 payment + order 两域, 事务内保持原子。
// 先由 order 域校验订单可退款(paid/shipped/completed, CAS 防重复), 再改支付单 refunded。
// 注意: drizzle 事务只有回调抛异常才回滚, 不能返回 Result 的 err(会被当正常结果提交)。
export async function refundOrderWorkflow(
  orderId: string,
  client: DbClient,
): Promise<
  Result<{ payment: typeof schema.payments.$inferSelect; order: OrderDetail }, RefundOrderErrorCode>
> {
  try {
    const value = await client.transaction(async (tx) => {
      const orderResult = await markOrderRefunded(orderId, tx)
      if (orderResult.isErr()) {
        throw new RefundError(
          orderResult.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' : 'INVALID_PAYMENT_STATE',
        )
      }

      const paymentResult = await refundOrder(orderId, tx)
      if (paymentResult.isErr()) throw new RefundError(paymentResult.error)

      return { payment: paymentResult.value, order: orderResult.value.order }
    })
    return ok(value)
  } catch (caught) {
    if (caught instanceof RefundError) return err(caught.code)
    throw caught
  }
}
