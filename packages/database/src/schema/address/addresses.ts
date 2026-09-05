import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

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
    province: varchar('province', { length: 50 }).notNull(),
    city: varchar('city', { length: 50 }).notNull().default(''),
    district: varchar('district', { length: 50 }).notNull().default(''),
    detail: varchar('detail', { length: 500 }).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userIdIdx: index('addresses_user_id_idx').on(t.userId),
    // 部分唯一索引: 每个用户至多一个默认地址(tech-debt #9, 并发下由 DB 兜底)
    defaultUniqueIdx: uniqueIndex('addresses_user_default_unique')
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
  }),
)
