import { Elysia, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

export const productWWWPlugin = new Elysia({ name: 'product-www', prefix: '/api/v1' })
  .use(productModel)
  .get(
    '/products',
    async ({ query }) => {
      return ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId as string | undefined,
        status: 'published',
      })
    },
    {
      query: 'ProductListQuery',
      detail: { tags: ['Products'] },
    },
  )
  .get('/products/:id', async ({ params: { id } }) => {
    const product = await ProductService.getById(id)
    if (!product) return null
    return product
  })
  .get('/categories', async () => ProductService.listCategories())
