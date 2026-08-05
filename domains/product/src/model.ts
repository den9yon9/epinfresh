import { PRODUCT_STATUS, table } from '@epinfresh/database'
import { PaginatedResponse, PaginationQuery } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

const statusLiteral = Type.Union(PRODUCT_STATUS.map((s) => Type.Literal(s)))

const ProductResponseSchema = Type.Intersect([
  table.select.product,
  Type.Object({ skus: Type.Array(table.select.productSku) }),
])

const skuInput = Type.Intersect([
  Type.Omit(table.insert.productSku, ['id', 'productId', 'price', 'createdAt', 'updatedAt']),
  Type.Object({
    price: Type.Number({ minimum: 0 }),
  }),
])

export const CreateProductInputSchema = Type.Intersect([
  Type.Omit(table.insert.product, ['id', 'createdAt', 'updatedAt']),
  Type.Object({
    skus: Type.Optional(Type.Array(skuInput, { maxItems: 100 })),
  }),
])

export const UpdateProductInputSchema = Type.Partial(
  Type.Omit(table.update.product, ['id', 'createdAt', 'updatedAt']),
)

export const CreateCategoryInputSchema = Type.Omit(table.insert.category, [
  'id',
  'createdAt',
  'updatedAt',
])

export { ProductResponseSchema }
export const ProductListResponseSchema = PaginatedResponse(ProductResponseSchema)
export const CategoryResponseSchema = table.select.category
export const CategoryListResponseSchema = PaginatedResponse(table.select.category)
export const CategoryListQuerySchema = PaginationQuery

export const ProductListQuerySchema = Type.Intersect([
  PaginationQuery,
  Type.Object({ categoryId: Type.Optional(Type.String({ format: 'uuid' })) }),
])

export const AdminProductListQuerySchema = Type.Intersect([
  PaginationQuery,
  Type.Object({
    categoryId: Type.Optional(Type.String({ format: 'uuid' })),
    status: Type.Optional(statusLiteral),
  }),
])
