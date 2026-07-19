import { table } from '@epinfresh/database'
import type { InferModelsMap } from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

export const productModel = new Elysia().model({
  CreateProductInput: t.Object({
    name: t.String(),
    slug: t.String(),
    description: t.Optional(t.String()),
    categoryId: t.Optional(t.String()),
    images: t.Optional(t.Array(t.String())),
    status: t.Optional(t.String()),
    skus: t.Optional(
      t.Array(
        t.Object({
          name: t.String(),
          skuCode: t.String(),
          price: t.Number(),
          stock: t.Optional(t.Number()),
          attributes: t.Optional(t.Record(t.String(), t.String())),
        }),
      ),
    ),
  }),

  UpdateProductInput: table.update.product,
  CreateCategoryInput: table.insert.category,
  ProductResponse: table.select.product,
  CategoryResponse: table.select.category,

  ProductDetailResponse: t.Object({
    ...table.select.product.properties,
    skus: t.Array(table.select.productSku),
  }),

  PaginatedProducts: t.Object({
    items: t.Array(table.select.product),
    total: t.Number(),
    page: t.Number(),
    pageSize: t.Number(),
  }),

  ProductListQuery: t.Object({
    page: t.Optional(t.String()),
    pageSize: t.Optional(t.String()),
    categoryId: t.Optional(t.String()),
  }),

  AdminProductListQuery: t.Object({
    page: t.Optional(t.String()),
    pageSize: t.Optional(t.String()),
    categoryId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),
})

export type ProductModel = InferModelsMap<typeof productModel>
