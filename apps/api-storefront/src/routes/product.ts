import type { Db } from '@epinfresh/database'
import {
  CategoryListQuerySchema,
  CategoryListResponseSchema,
  ProductListQuerySchema,
  ProductListResponseSchema,
  ProductResponseSchema,
  getProductByIdPublic,
  listCategories,
  listPublishedProducts,
} from '@epinfresh/product'
import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

export function productRoutes(deps: { db: Db }) {
  return new Elysia({ name: 'product-storefront', prefix: '/api/v1' })
    .use(commonModel)
    .decorate('db', deps.db)
    .get('/products', async ({ query, db }) => listPublishedProducts(query, db), {
      query: ProductListQuerySchema,
      response: { 200: ProductListResponseSchema },
      detail: { tags: ['Products'] },
    })
    .get(
      '/products/:id',
      async ({ params, db }) => {
        const result = await getProductByIdPublic(params.id, db)
        return result.match(
          (p) => p,
          (code) => status(404, { error: code, message: 'Product not found' }),
        )
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: ProductResponseSchema, 404: 'ErrorResponse' as const },
        detail: { tags: ['Products'] },
      },
    )
    .get('/categories', ({ query, db }) => listCategories(query, db), {
      query: CategoryListQuerySchema,
      response: { 200: CategoryListResponseSchema },
      detail: { tags: ['Categories'] },
    })
}
