import { decimal, index, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { orders } from './orders'

export const PAYMENT_STATUS = ['pending', 'succeeded', 'failed', 'refunded', 'cancelled'] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUS)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'restrict' })
      .notNull(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    status: paymentStatus('status').default('pending').notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    providerRef: varchar('provider_ref', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    orderIdIdx: index('payments_order_id_idx').on(t.orderId),
  }),
)
