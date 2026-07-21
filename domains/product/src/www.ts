import { Elysia, status, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

export const productWWWPlugin = new Elysia({ name: 'product-www', prefix: '/api/v1' })
  .use(productModel)
  .get(
    '/products',
    async ({ query }) =>
      ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId,
        status: 'published',
      }),
    {
      query: 'ProductListQuery',
      response: { 200: 'ProductListResponse' },
      detail: { tags: ['Products'] },
    },
  )
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.getByIdPublic(params.id)
      return result.match(
        (p) => p,
        () => status(404, { error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: 'ProductResponse', 404: 'ErrorResponse' },
      detail: { tags: ['Products'] },
    },
  )
  .get('/categories', () => ProductService.listCategories(), {
    response: { 200: 'CategoryListResponse' },
    detail: { tags: ['Categories'] },
  })
