import { decimal, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { orders } from './orders'
import { productSkus } from './product-skus'

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => productSkus.id, { onDelete: 'restrict' })
      .notNull(),
    productName: varchar('product_name', { length: 255 }).notNull(),
    skuName: varchar('sku_name', { length: 255 }).notNull(),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orderIdIdx: index('order_items_order_id_idx').on(t.orderId),
    skuIdIdx: index('order_items_sku_id_idx').on(t.skuId),
  }),
)
