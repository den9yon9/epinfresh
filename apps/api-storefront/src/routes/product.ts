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

export const productRoutes = new Elysia({ name: 'product-storefront', prefix: '/api/v1' })
  .use(commonModel)
  .get('/products', async ({ query }) => listPublishedProducts(query), {
    query: ProductListQuerySchema,
    response: { 200: ProductListResponseSchema },
    detail: { tags: ['Products'] },
  })
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await getProductByIdPublic(params.id)
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
  .get('/categories', ({ query }) => listCategories(query), {
    query: CategoryListQuerySchema,
    response: { 200: CategoryListResponseSchema },
    detail: { tags: ['Categories'] },
  })
