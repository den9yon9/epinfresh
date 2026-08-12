import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { products } from './products'

export const productSkus = pgTable(
  'product_skus',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    skuCode: varchar('sku_code', { length: 100 }).unique().notNull(),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    stock: integer('stock').default(0).notNull(),
    attributes: jsonb('attributes').$type<Record<string, string>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    productIdIdx: index('product_skus_product_id_idx').on(t.productId),
  }),
)
