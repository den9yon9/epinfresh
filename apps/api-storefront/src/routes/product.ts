import { commonModel } from '@epinfresh/http'
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
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'
import { storeDb } from '../plugins'

export const productRoutes = new Elysia({ name: 'product-storefront', prefix: '/api/v1' })
  .use(commonModel)
  .use(storeDb)
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
        (code) => {
          switch (code) {
            case 'PRODUCT_NOT_FOUND':
              return status(404, { error: code, message: 'Product not found' })
          }
        },
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: ProductResponseSchema, 404: ErrorResponse },
      detail: { tags: ['Products'] },
    },
  )
  .get('/categories', ({ query, db }) => listCategories(query, db), {
    query: CategoryListQuerySchema,
    response: { 200: CategoryListResponseSchema },
    detail: { tags: ['Categories'] },
  })
