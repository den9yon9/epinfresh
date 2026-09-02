import { type DbClient } from '@epinfresh/database'
import { getPayableOrder } from '@epinfresh/order'
import {
  initiatePayment,
  type PaymentGateway,
  type PaymentPayload,
  type PaymentRecord,
} from '@epinfresh/payment'
import { err, type Result } from '@epinfresh/shared'

export type InitiateOrderPaymentError = 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'GATEWAY_ERROR'

// 编排: 发起支付跨 order + payment 两域——订单存在性与可支付状态在此校验(快照经
// order 域 getPayableOrder 取得), 支付单创建/幂等复用/网关调用归 payment 域。
// 无事务: 网关调用是外部副作用不进事务, 失败由 payment 域"作废旧单"补偿
// (与原 initiatePayment 直查订单的结构一致)。
export async function initiateOrderPayment(
  orderId: string,
  gateway: PaymentGateway,
  client: DbClient,
  channelContext?: Record<string, unknown>,
): Promise<Result<{ payment: PaymentRecord; payload: PaymentPayload }, InitiateOrderPaymentError>> {
  const orderResult = await getPayableOrder(orderId, client)
  if (orderResult.isErr()) return err('ORDER_NOT_FOUND')
  if (orderResult.value.status !== 'pending') return err('ORDER_NOT_PENDING')
  const { id, totalAmount, currency } = orderResult.value
  return initiatePayment({ id, totalAmount, currency }, gateway, client, channelContext)
}
