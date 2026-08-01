import type { Db } from '@epinfresh/database'
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
import type { Redis } from '@epinfresh/redis'
import { createSessionPlugin } from '@epinfresh/session'
import { ErrorResponse, type Logger, commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

const adminResponse = { 401: ErrorResponse, 403: ErrorResponse } as const

export function productRoutes(deps: {
  db: Db
  redis: Redis
  logger: Logger
  sessionSecret: string
  isProduction: boolean
}) {
  const { logger, sessionSecret, isProduction } = deps
  return new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
    .use(commonModel)
    .decorate('db', deps.db)
    .use(createSessionPlugin({ redis: deps.redis, sessionSecret, isProduction, logger }))
    .get('/products', async ({ query, db }) => listAllProducts(query, db), {
      isAdmin: true,
      query: AdminProductListQuerySchema,
      response: { 200: ProductListResponseSchema, ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    })
    .get(
      '/products/:id',
      async ({ params, db }) => {
        const result = await getProductById(params.id, db)
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
    .post('/products', async ({ body, db }) => status(201, await createProduct(body, db)), {
      isAdmin: true,
      body: CreateProductInputSchema,
      response: { 201: ProductResponseSchema, ...adminResponse },
      detail: { tags: ['Admin/Products'] },
    })
    .put(
      '/products/:id',
      async ({ params, body, db }) => {
        const result = await updateProduct(params.id, body, db)
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
      async ({ params, db }) => {
        const result = await removeProduct(params.id, db)
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
    .get('/categories', ({ query, db }) => listCategories(query, db), {
      isAdmin: true,
      query: CategoryListQuerySchema,
      response: { 200: CategoryListResponseSchema, ...adminResponse },
      detail: { tags: ['Admin/Categories'] },
    })
    .post('/categories', async ({ body, db }) => status(201, await createCategory(body, db)), {
      isAdmin: true,
      body: CreateCategoryInputSchema,
      response: { 201: CategoryResponseSchema, ...adminResponse },
      detail: { tags: ['Admin/Categories'] },
    })
    .delete(
      '/categories/:id',
      async ({ params, db }) => {
        const result = await removeCategory(params.id, db)
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
}
