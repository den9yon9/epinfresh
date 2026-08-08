import { relations } from 'drizzle-orm'

import { addresses } from './addresses'
import { cartItems } from './cart-items'
import { categories } from './categories'
import { checkoutIdempotencyKeys } from './checkout-idempotency-keys'
import { orderItems } from './order-items'
import { orders } from './orders'
import { payments } from './payments'
import { productSkus } from './product-skus'
import { products } from './products'
import { users } from './users'

export const productsRelations = relations(products, ({ many, one }) => ({
  skus: many(productSkus),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}))

export const productSkusRelations = relations(productSkus, ({ one }) => ({
  product: one(products, {
    fields: [productSkus.productId],
    references: [products.id],
  }),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  products: many(products),
}))

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  addresses: many(addresses),
  cartItems: many(cartItems),
  checkoutIdempotencyKeys: many(checkoutIdempotencyKeys),
}))

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, {
    fields: [cartItems.userId],
    references: [users.id],
  }),
  sku: one(productSkus, {
    fields: [cartItems.skuId],
    references: [productSkus.id],
  }),
}))

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, {
    fields: [addresses.userId],
    references: [users.id],
  }),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  address: one(addresses, {
    fields: [orders.addressId],
    references: [addresses.id],
  }),
  items: many(orderItems),
  payments: many(payments),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}))

export const checkoutIdempotencyKeysRelations = relations(checkoutIdempotencyKeys, ({ one }) => ({
  user: one(users, {
    fields: [checkoutIdempotencyKeys.userId],
    references: [users.id],
  }),
  order: one(orders, {
    fields: [checkoutIdempotencyKeys.orderId],
    references: [orders.id],
  }),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  sku: one(productSkus, {
    fields: [orderItems.skuId],
    references: [productSkus.id],
  }),
}))
