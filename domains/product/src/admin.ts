import { Elysia, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

export const productAdminPlugin = new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
  .use(productModel)
  .get(
    '/products',
    async ({ query }) => {
      return ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId as string | undefined,
        status: query.status as string | undefined,
      })
    },
    {
      query: 'AdminProductListQuery',
    },
  )
  .get('/products/:id', async ({ params: { id }, status }) => {
    const product = await ProductService.getById(id)
    if (!product) return status(404, 'Not found')
    return product
  })
  .post('/products', async ({ body }) => ProductService.create(body), {
    body: 'CreateProductInput',
  })
  .put(
    '/products/:id',
    async ({ params: { id }, body, status }) => {
      const product = await ProductService.update(id, body)
      if (!product) return status(404, 'Not found')
      return product
    },
    {
      body: 'UpdateProductInput',
    },
  )
  .delete('/products/:id', async ({ params: { id }, status }) => {
    await ProductService.remove(id)
    return status(204)
  })
  .get('/categories', async () => ProductService.listCategories())
  .post('/categories', async ({ body }) => ProductService.createCategory(body), {
    body: 'CreateCategoryInput',
  })
  .delete('/categories/:id', async ({ params: { id }, status }) => {
    await ProductService.removeCategory(id)
    return status(204)
  })
