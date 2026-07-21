import type { InferModelsMap, ProductStatus } from '@epinfresh/shared'
import { PRODUCT_STATUS } from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

const STATUS_LITERALS = PRODUCT_STATUS.map((s) => t.Literal(s))

const skuInput = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  skuCode: t.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' }),
  price: t.Number({ minimum: 0 }),
  stock: t.Optional(t.Integer({ minimum: 0 })),
  attributes: t.Optional(t.Record(t.String({ maxLength: 64 }), t.String({ maxLength: 1024 }))),
})

export const productModel = new Elysia().model({
  CreateProductInput: t.Object({
    name: t.String({ minLength: 1, maxLength: 255 }),
    slug: t.String({ minLength: 1, maxLength: 255, pattern: '^[a-z0-9-]+$' }),
    description: t.Optional(t.String({ maxLength: 65535 })),
    categoryId: t.Optional(t.String({ format: 'uuid' })),
    images: t.Optional(t.Array(t.String({ maxLength: 2048 }), { maxItems: 20 })),
    status: t.Optional(t.Union(STATUS_LITERALS)),
    skus: t.Optional(t.Array(skuInput, { maxItems: 100 })),
  }),

  UpdateProductInput: t.Partial(
    t.Object({
      name: t.String({ minLength: 1, maxLength: 255 }),
      slug: t.String({ minLength: 1, maxLength: 255, pattern: '^[a-z0-9-]+$' }),
      description: t.String({ maxLength: 65535 }),
      categoryId: t.String({ format: 'uuid' }),
      images: t.Array(t.String({ maxLength: 2048 }), { maxItems: 20 }),
      status: t.Union(STATUS_LITERALS),
    }),
  ),

  CreateCategoryInput: t.Object({
    name: t.String({ minLength: 1, maxLength: 255 }),
    slug: t.String({ minLength: 1, maxLength: 255, pattern: '^[a-z0-9-]+$' }),
    parentId: t.Optional(t.String({ format: 'uuid' })),
    sortOrder: t.Optional(t.Integer({ minimum: 0 })),
  }),

  ProductListQuery: t.Object({
    page: t.Optional(t.String()),
    pageSize: t.Optional(t.String()),
    categoryId: t.Optional(t.String({ format: 'uuid' })),
  }),

  AdminProductListQuery: t.Object({
    page: t.Optional(t.String()),
    pageSize: t.Optional(t.String()),
    categoryId: t.Optional(t.String({ format: 'uuid' })),
    status: t.Optional(t.Union(STATUS_LITERALS)),
  }),
})

export type ProductModel = InferModelsMap<typeof productModel>
export type { ProductStatus }
