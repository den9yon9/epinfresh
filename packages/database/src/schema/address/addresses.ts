import { boolean, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { users } from './../user/users'

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    recipientName: varchar('recipient_name', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 50 }).notNull(),
    address: varchar('address', { length: 500 }).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userIdIdx: index('addresses_user_id_idx').on(t.userId),
  }),
)
