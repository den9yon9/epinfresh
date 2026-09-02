import { type DbClient, schema } from '@epinfresh/database'
import { InvariantViolation } from '@epinfresh/shared'
import { EMAIL_JOB_NAMES, type SendEmailJobData } from '@epinfresh/user/jobs'
import { eq } from 'drizzle-orm'

// 邮件队列端口(结构化类型, 不依赖 infrastructure): BullMQ Queue.add 天然满足此形状
export interface EmailQueuePort {
  add(name: string, data: SendEmailJobData, opts?: { jobId?: string }): Promise<unknown>
}

// outbox 事件(写入侧见各 usecase 的事务点); payload 以 unknown 接入(drizzle jsonb),
// 由 requireString/optionalString 校验
export interface OutboxEventLike {
  id: string
  payload: unknown
}

export type OrderEmailDeps = { client: DbClient; emailQueue: EmailQueuePort }

function requireString(eventType: string, payload: unknown, key: string): string {
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvariantViolation(`${eventType} event payload missing "${key}"`)
  }
  return value
}

function optionalString(payload: unknown, key: string): string | undefined {
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// 收件人定位: 事件只带 orderId, 邮箱/称呼查 order → user。
// 收件人缺失属数据完整性异常, 直接抛错 → outbox 退避重试直至死信告警, 不静默吞掉。
async function resolveOrderRecipient(
  eventType: string,
  client: DbClient,
  orderId: string,
): Promise<{ email: string; name: string }> {
  const [order] = await client
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)
  if (!order) throw new InvariantViolation(`${eventType} email: order not found (${orderId})`)

  const [user] = await client
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, order.userId))
    .limit(1)
  if (!user) throw new InvariantViolation(`${eventType} email: user not found (${order.userId})`)
  // name 列可空: 邮件称呼兜底
  return { email: user.email, name: user.name ?? '用户' }
}

// 编排: 支付成功事件 → 收件人 → 投递邮件任务。
// jobId 以 paymentId 派生: outbox at-least-once 重投时 BullMQ 依 jobId 去重, 邮件不重复发送。
export async function sendPaymentSucceededEmail(
  event: OutboxEventLike,
  deps: OrderEmailDeps,
): Promise<void> {
  const orderId = requireString('payment.succeeded', event.payload, 'orderId')
  const paymentId = requireString('payment.succeeded', event.payload, 'paymentId')
  const amount = requireString('payment.succeeded', event.payload, 'amount')
  const currency = requireString('payment.succeeded', event.payload, 'currency')
  const provider = requireString('payment.succeeded', event.payload, 'provider')
  const paidAt = requireString('payment.succeeded', event.payload, 'paidAt')

  const { email, name } = await resolveOrderRecipient('payment.succeeded', deps.client, orderId)
  await deps.emailQueue.add(
    EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED,
    {
      to: email,
      payload: { name, orderId, amount, currency, provider, paidAt },
    },
    { jobId: `payment-succeeded-${paymentId}` },
  )
}

// 退款成功事件(三个事务点写入, payload 同构): 退款单号/金额/订单 → 收件人
export async function sendRefundSucceededEmail(
  event: OutboxEventLike,
  deps: OrderEmailDeps,
): Promise<void> {
  const refundNo = requireString('refund.succeeded', event.payload, 'refundNo')
  const orderId = requireString('refund.succeeded', event.payload, 'orderId')
  const amount = requireString('refund.succeeded', event.payload, 'amount')
  const currency = requireString('refund.succeeded', event.payload, 'currency')

  const { email, name } = await resolveOrderRecipient('refund.succeeded', deps.client, orderId)
  await deps.emailQueue.add(
    EMAIL_JOB_NAMES.REFUND_SUCCEEDED,
    {
      to: email,
      payload: { name, orderId, refundNo, amount, currency },
    },
    { jobId: `refund-succeeded-${refundNo}` },
  )
}

// 发货事件(shipOrder paid→shipped 转变时写入): 运单号可缺省(发货时可暂无单号)
export async function sendOrderShippedEmail(
  event: OutboxEventLike,
  deps: OrderEmailDeps,
): Promise<void> {
  const orderId = requireString('order.shipped', event.payload, 'orderId')
  const trackingNumber = optionalString(event.payload, 'trackingNumber')
  const courierCompany = optionalString(event.payload, 'courierCompany')
  requireString('order.shipped', event.payload, 'shippedAt')

  const { email, name } = await resolveOrderRecipient('order.shipped', deps.client, orderId)
  await deps.emailQueue.add(
    EMAIL_JOB_NAMES.ORDER_SHIPPED,
    {
      to: email,
      payload: { name, orderId, trackingNumber, courierCompany },
    },
    { jobId: `order-shipped-${orderId}` },
  )
}
