import {
  AdminProductListQuerySchema,
  CategoryListQuerySchema,
  CategoryListResponseSchema,
  CategoryResponseSchema,
  CreateCategoryInputSchema,
  CreateProductInputSchema,
  ProductListResponseSchema,
  ProductResponseSchema,
  UpdateProductInputSchema,
  createCategory,
  createProduct,
  getProductById,
  listAllProducts,
  listCategories,
  removeCategory,
  removeProduct,
  updateProduct,
} from '@epinfresh/product'
import { sessionPlugin } from '@epinfresh/session'
import { ErrorResponse, commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

const adminResponse = { 401: ErrorResponse, 403: ErrorResponse } as const

export const productRoutes = new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
  .use(commonModel)
  .use(sessionPlugin)
  .get('/products', async ({ query }) => listAllProducts(query), {
    isAdmin: true,
    query: AdminProductListQuerySchema,
    response: { 200: ProductListResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Products'] },
  })
  .get(
    '/products/:id',
    async ({ params }) => {
      const result = await getProductById(params.id)
      return result.match(
        (p) => p,
        (code) => status(404, { error: code, message: 'Product not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: ProductResponseSchema, 404: ErrorResponse, ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    },
  )
  .post('/products', async ({ body }) => status(201, await createProduct(body)), {
    isAdmin: true,
    body: CreateProductInputSchema,
    response: { 201: ProductResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Products'] },
  })
  .put(
    '/products/:id',
    async ({ params, body }) => {
      const result = await updateProduct(params.id, body)
      return result.match(
        (p) => p,
        (code) => status(404, { error: code, message: 'Product not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: UpdateProductInputSchema,
      response: { 200: ProductResponseSchema, 404: ErrorResponse, ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    },
  )
  .delete(
    '/products/:id',
    async ({ params }) => {
      const result = await removeProduct(params.id)
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
  .get('/categories', ({ query }) => listCategories(query), {
    isAdmin: true,
    query: CategoryListQuerySchema,
    response: { 200: CategoryListResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Categories'] },
  })
  .post('/categories', async ({ body }) => status(201, await createCategory(body)), {
    isAdmin: true,
    body: CreateCategoryInputSchema,
    response: { 201: CategoryResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Categories'] },
  })
  .delete(
    '/categories/:id',
    async ({ params }) => {
      const result = await removeCategory(params.id)
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
