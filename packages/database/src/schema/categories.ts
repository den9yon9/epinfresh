import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  // Self-reference FK added in raw SQL migration (TS001); cannot declare here
  // because of pgTable `categories` self-type inference cycle.
  parentId: uuid('parent_id'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
