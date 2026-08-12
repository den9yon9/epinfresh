import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { productSkus } from './../product/product-skus'
import { users } from './../user/users'

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => productSkus.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    userSkuIdx: uniqueIndex('cart_items_user_sku_idx').on(t.userId, t.skuId),
    userIdIdx: index('cart_items_user_id_idx').on(t.userId),
  }),
)
