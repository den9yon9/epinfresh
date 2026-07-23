import { relations } from 'drizzle-orm'
import { categories } from './categories'
import { productSkus } from './product-skus'
import { products } from './products'

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
