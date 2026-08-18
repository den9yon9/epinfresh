import {
  decimal,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { orders } from '../order/orders'
import { payments } from './payments'

// 退款单状态: 提交后 processing, 渠道通知/同步返回后 succeeded / abnormal
export const REFUND_STATUS = ['processing', 'succeeded', 'abnormal'] as const
export type RefundStatus = (typeof REFUND_STATUS)[number]

export const refundStatus = pgEnum('refund_status', REFUND_STATUS)

// 退款单: 真实渠道(微信)退款异步, 提交时落 processing, 结果由退款通知驱动。
// mock/支付宝退款同步, 提交即 succeeded。
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .references(() => payments.id, { onDelete: 'restrict' })
      .notNull(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'restrict' })
      .notNull(),
    // 确定性派生(rf-{paymentId}), 渠道幂等键
    outRefundNo: varchar('out_refund_no', { length: 64 }).notNull(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    status: refundStatus('status').default('processing').notNull(),
    // 渠道退款单号(退款通知/查询回填)
    providerRefundId: varchar('provider_refund_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    outRefundNoUniqueIdx: uniqueIndex('refunds_out_refund_no_unique').on(t.outRefundNo),
    paymentIdIdx: index('refunds_payment_id_idx').on(t.paymentId),
  }),
)
