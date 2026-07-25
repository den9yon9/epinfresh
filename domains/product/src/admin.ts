import { createSessionPlugin } from '@epinfresh/session'
import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

const adminResponse = { 401: 'ErrorResponse', 403: 'ErrorResponse' } as const

export const productAdminPlugin = new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
  .use(productModel)
  .use(commonModel)
  .use(createSessionPlugin())
  .get('/products', async ({ query }) => ProductService.list(query), {
    isAdmin: true,
    query: 'AdminProductListQuery',
    response: { 200: 'ProductListResponse', ...adminResponse },
    detail: { tags: ['Admin/Products'] },
  })
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.getById(params.id)
      return result.match(
        (p) => p,
        (code) => status(404, { error: code, message: 'Product not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: 'ProductResponse', 404: 'ErrorResponse', ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    },
  )
  .post('/products', async ({ body }) => status(201, await ProductService.create(body)), {
    isAdmin: true,
    body: 'CreateProductInput',
    response: { 201: 'ProductResponse', ...adminResponse },
    detail: { tags: ['Admin/Products'] },
  })
  .put(
    '/products/:id',
    async ({ params, body }) => {
      const result = await ProductService.update(params.id, body)
      return result.match(
        (p) => p,
        (code) => status(404, { error: code, message: 'Product not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: 'UpdateProductInput',
      response: { 200: 'ProductResponse', 404: 'ErrorResponse', ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    },
  )
  .delete(
    '/products/:id',
    async ({ params }) => {
      const result = await ProductService.remove(params.id)
      return result.match(
        () => status(204),
        (code) => status(404, { error: code, message: 'Product not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Products'] },
    },
  )
  .get('/categories', () => ProductService.listCategories(), {
    isAdmin: true,
    response: { 200: 'CategoryListResponse', ...adminResponse },
    detail: { tags: ['Admin/Categories'] },
  })
  .post('/categories', async ({ body }) => status(201, await ProductService.createCategory(body)), {
    isAdmin: true,
    body: 'CreateCategoryInput',
    response: { 201: 'CategoryResponse', ...adminResponse },
    detail: { tags: ['Admin/Categories'] },
  })
  .delete(
    '/categories/:id',
    async ({ params }) => {
      const result = await ProductService.removeCategory(params.id)
      return result.match(
        () => status(204),
        (code) => {
          switch (code) {
            case 'CATEGORY_NOT_FOUND':
              return status(404, { error: code, message: 'Category not found' })
            case 'CATEGORY_HAS_PRODUCTS':
              return status(409, {
                error: code,
                message: 'Category still has products',
              })
          }
        },
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Categories'] },
    },
  )
