import { commonModel } from '@epinfresh/http'
import { getProductByIdPublic, listCategories, listPublishedProducts } from '@epinfresh/product'
import * as ProductModel from '@epinfresh/product/model'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { storeDb } from '../plugins'

export const productRoutes = new Elysia({ name: 'product-storefront', prefix: '/api/v1' })
  .use(commonModel)
  .use(storeDb)
  .get('/products', async ({ query, db }) => listPublishedProducts(query, db), {
    query: ProductModel.ProductListQuerySchema,
    response: { 200: ProductModel.ProductListResponseSchema },
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
      response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
      detail: { tags: ['Products'] },
    },
  )
  .get('/categories', ({ query, db }) => listCategories(query, db), {
    query: ProductModel.CategoryListQuerySchema,
    response: { 200: ProductModel.CategoryListResponseSchema },
    detail: { tags: ['Categories'] },
  })
