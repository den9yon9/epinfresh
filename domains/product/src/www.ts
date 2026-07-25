import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

export const productWWWPlugin = new Elysia({ name: 'product-www', prefix: '/api/v1' })
  .use(productModel)
  .use(commonModel)
  .get('/products', async ({ query }) => ProductService.list({ ...query, status: 'published' }), {
    query: 'ProductListQuery',
    response: { 200: 'ProductListResponse' },
    detail: { tags: ['Products'] },
  })
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.getByIdPublic(params.id)
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
  .get('/categories', ({ query }) => ProductService.listCategories(query), {
    query: 'CategoryListQuery',
    response: { 200: 'CategoryListResponse' },
    detail: { tags: ['Categories'] },
  })
