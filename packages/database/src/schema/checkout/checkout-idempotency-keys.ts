import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

import { orders } from './../order/orders'
import { users } from './../user/users'

export const checkoutIdempotencyKeys = pgTable(
  'checkout_idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userKeyIdx: uniqueIndex('checkout_idempotency_keys_user_key_idx').on(t.userId, t.key),
    orderIdIdx: index('checkout_idempotency_keys_order_id_idx').on(t.orderId),
  }),
)
