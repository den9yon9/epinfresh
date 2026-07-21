import { Elysia, status, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

export const productAdminPlugin = new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
  .use(productModel)
  .get(
    '/products',
    async ({ query }) =>
      ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId,
        status: undefined,
      }),
    { query: 'AdminProductListQuery', detail: { tags: ['Admin/Products'] } },
  )
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.getById(params.id)
      return result.match(
        (p) => p,
        () => status(404, { error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Products'] },
    },
  )
  .post(
    '/products',
    async ({ body, set }) => {
      const product = await ProductService.create(body)
      set.status = 201
      return product
    },
    { body: 'CreateProductInput', detail: { tags: ['Admin/Products'] } },
  )
  .put(
    '/products/:id',
    async ({ params, body }) => {
      const result = await ProductService.update(params.id, body)
      return result.match(
        (p) => p,
        () => status(404, { error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: 'UpdateProductInput',
      detail: { tags: ['Admin/Products'] },
    },
  )
  .delete(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.remove(params.id)
      return result.match(
        () => status(204),
        () => status(404, { error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Products'] },
    },
  )
  .get('/categories', () => ProductService.listCategories(), {
    detail: { tags: ['Admin/Categories'] },
  })
  .post(
    '/categories',
    async ({ body, set }) => {
      const cat = await ProductService.createCategory(body)
      set.status = 201
      return cat
    },
    { body: 'CreateCategoryInput', detail: { tags: ['Admin/Categories'] } },
  )
  .delete(
    '/categories/:id',
    async ({ params }) => {
      const result = await ProductService.removeCategory(params.id)
      return result.match(
        () => status(204),
        (err) => {
          switch (err) {
            case 'CATEGORY_NOT_FOUND':
              return status(404, { error: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
            case 'CATEGORY_HAS_PRODUCTS':
              return status(409, {
                error: 'CATEGORY_HAS_PRODUCTS',
                message: 'Category still has products',
              })
          }
        },
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Categories'] },
    },
  )
