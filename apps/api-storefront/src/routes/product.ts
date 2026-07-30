import {
  getProductByIdPublic,
  listCategories,
  listPublishedProducts,
  productModel,
} from '@epinfresh/product'
import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

export const productRoutes = new Elysia({ name: 'product-storefront', prefix: '/api/v1' })
  .use(productModel)
  .use(commonModel)
  .get('/products', async ({ query }) => listPublishedProducts(query), {
    query: 'ProductListQuery',
    response: { 200: 'ProductListResponse' },
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
      response: { 200: 'ProductResponse', 404: 'ErrorResponse' },
      detail: { tags: ['Products'] },
    },
  )
  .get('/categories', ({ query }) => listCategories(query), {
    query: 'CategoryListQuery',
    response: { 200: 'CategoryListResponse' },
    detail: { tags: ['Categories'] },
  })
