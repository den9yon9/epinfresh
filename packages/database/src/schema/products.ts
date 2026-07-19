import { jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { categories } from './categories'

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  description: text('description'),
  categoryId: uuid('category_id').references(() => categories.id),
  images: jsonb('images').default([]).notNull(),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
