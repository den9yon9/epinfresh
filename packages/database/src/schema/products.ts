import { PRODUCT_STATUS } from '@epinfresh/shared'
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { categories } from './categories'

export const productStatus = pgEnum('product_status', PRODUCT_STATUS)

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).unique().notNull(),
    description: text('description'),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    images: jsonb('images').$type<string[]>().default([]).notNull(),
    status: productStatus('status').default('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    statusIdx: index('products_status_idx').on(t.status),
    categoryIdIdx: index('products_category_id_idx').on(t.categoryId),
    createdAtIdx: index('products_created_at_idx').on(t.createdAt),
  }),
)
