import { decimal, index, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { addresses } from './../address/addresses'
import { users } from './../user/users'

export const ORDER_STATUS = [
  'pending',
  'paid',
  'shipped',
  'completed',
  'refunded',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUS)[number]

export const orderStatus = pgEnum('order_status', ORDER_STATUS)

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    status: orderStatus('status').default('pending').notNull(),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    addressId: uuid('address_id').references(() => addresses.id, { onDelete: 'set null' }),
    recipientName: varchar('recipient_name', { length: 100 }).notNull().default(''),
    recipientPhone: varchar('recipient_phone', { length: 50 }).notNull().default(''),
    shippingAddress: varchar('shipping_address', { length: 500 }).notNull().default(''),
    trackingNumber: varchar('tracking_number', { length: 100 }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userIdIdx: index('orders_user_id_idx').on(t.userId),
    statusIdx: index('orders_status_idx').on(t.status),
    createdAtIdx: index('orders_created_at_idx').on(t.createdAt),
  }),
)
