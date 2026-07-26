import { table } from '@epinfresh/database'
import {
  type InferModelsMap,
  PRODUCT_STATUS,
  PaginatedResponse,
  PaginationQuery,
} from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

const STATUS_LITERALS = PRODUCT_STATUS.map((s) => t.Literal(s))

const ProductResponseSchema = t.Intersect([
  table.select.product,
  t.Object({ skus: t.Array(table.select.productSku) }),
])

const skuInput = t.Intersect([
  t.Omit(table.insert.productSku, ['id', 'productId', 'price', 'createdAt', 'updatedAt']),
  t.Object({
    price: t.Number({ minimum: 0 }),
  }),
])

export const productModel = new Elysia({ name: 'product-model' }).model({
  CreateProductInput: t.Intersect([
    t.Omit(table.insert.product, ['id', 'createdAt', 'updatedAt']),
    t.Object({
      skus: t.Optional(t.Array(skuInput, { maxItems: 100 })),
    }),
  ]),

  UpdateProductInput: t.Partial(t.Omit(table.update.product, ['id', 'createdAt', 'updatedAt'])),

  CreateCategoryInput: t.Omit(table.insert.category, ['id', 'createdAt', 'updatedAt']),

  ProductResponse: ProductResponseSchema,
  ProductListResponse: PaginatedResponse(ProductResponseSchema),
  CategoryResponse: table.select.category,
  CategoryListResponse: PaginatedResponse(table.select.category),
  CategoryListQuery: PaginationQuery,

  ProductListQuery: t.Intersect([
    PaginationQuery,
    t.Object({ categoryId: t.Optional(t.String({ format: 'uuid' })) }),
  ]),

  AdminProductListQuery: t.Intersect([
    PaginationQuery,
    t.Object({
      categoryId: t.Optional(t.String({ format: 'uuid' })),
      status: t.Optional(t.Union(STATUS_LITERALS)),
    }),
  ]),
})

export type ProductModel = InferModelsMap<typeof productModel>
