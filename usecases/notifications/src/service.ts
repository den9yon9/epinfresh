import { type DbClient, schema } from '@epinfresh/database'
import { EMAIL_JOB_NAMES, type SendEmailJobData } from '@epinfresh/user/jobs'
import { eq } from 'drizzle-orm'

// 邮件队列端口(结构化类型, 不依赖 infrastructure): BullMQ Queue.add 天然满足此形状
export interface EmailQueuePort {
  add(name: string, data: SendEmailJobData, opts?: { jobId?: string }): Promise<unknown>
}

// outbox 'payment.succeeded' 事件 payload 契约(写入侧见 usecases/payment-confirm);
// payload 以 unknown 接入(drizzle jsonb), 由 requireString 校验
export interface PaymentSucceededEvent {
  id: string
  payload: unknown
}

function requireString(payload: unknown, key: string): string {
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`payment.succeeded event payload missing "${key}"`)
  }
  return value
}

// 编排: 支付成功事件 → 查订单/用户拿收件人 → 投递邮件任务。
// 收件人缺失属数据完整性异常, 直接抛错 → outbox 退避重试直至死信告警, 不静默吞掉。
// jobId 以 paymentId 派生: outbox at-least-once 重投时 BullMQ 依 jobId 去重, 邮件不重复发送。
export async function sendPaymentSucceededEmail(
  event: PaymentSucceededEvent,
  deps: { client: DbClient; emailQueue: EmailQueuePort },
): Promise<void> {
  const orderId = requireString(event.payload, 'orderId')
  const paymentId = requireString(event.payload, 'paymentId')
  const amount = requireString(event.payload, 'amount')
  const currency = requireString(event.payload, 'currency')
  const provider = requireString(event.payload, 'provider')
  const paidAt = requireString(event.payload, 'paidAt')

  const [order] = await deps.client
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)
  if (!order) throw new Error(`payment.succeeded email: order not found (${orderId})`)

  const [user] = await deps.client
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, order.userId))
    .limit(1)
  if (!user) throw new Error(`payment.succeeded email: user not found (${order.userId})`)

  await deps.emailQueue.add(
    EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED,
    {
      to: user.email,
      payload: { name: user.name, orderId, amount, currency, provider, paidAt },
    },
    { jobId: `payment-succeeded-${paymentId}` },
  )
}
