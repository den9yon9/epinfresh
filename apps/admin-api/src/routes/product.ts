import {
  createCategory,
  createProduct,
  getProductById,
  listAllProducts,
  listCategories,
  removeCategory,
  removeProduct,
  updateProduct,
} from '@epinfresh/product'
import * as ProductModel from '@epinfresh/product/model'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type AdminPlugins } from '../plugins'

export function createProductRoutes(plugins: AdminPlugins) {
  return new Elysia({ name: 'product-admin', prefix: '/admin' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .get('/products', async ({ query, db }) => listAllProducts(query, db), {
      isAdmin: true,
      query: ProductModel.AdminProductListQuerySchema,
      response: { 200: ProductModel.ProductListResponseSchema },
      detail: { tags: ['Admin/Products'] },
    })
    .get(
      '/products/:id',
      async ({ params, db }) => {
        const result = await getProductById(params.id, db)
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
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Admin/Products'] },
      },
    )
    .post('/products', async ({ body, db }) => status(201, await createProduct(body, db)), {
      isAdmin: true,
      body: ProductModel.CreateProductInputSchema,
      response: { 201: ProductModel.ProductResponseSchema },
      detail: { tags: ['Admin/Products'] },
    })
    .put(
      '/products/:id',
      async ({ params, body, db }) => {
        const result = await updateProduct(params.id, body, db)
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
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: ProductModel.UpdateProductInputSchema,
        response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Admin/Products'] },
      },
    )
    .delete(
      '/products/:id',
      async ({ params, db }) => {
        const result = await removeProduct(params.id, db)
        return result.match(
          () => status(204),
          (code) => {
            switch (code) {
              case 'PRODUCT_NOT_FOUND':
                return status(404, { error: code, message: 'Product not found' })
            }
          },
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
      query: ProductModel.CategoryListQuerySchema,
      response: { 200: ProductModel.CategoryListResponseSchema },
      detail: { tags: ['Admin/Categories'] },
    })
    .post('/categories', async ({ body, db }) => status(201, await createCategory(body, db)), {
      isAdmin: true,
      body: ProductModel.CreateCategoryInputSchema,
      response: { 201: ProductModel.CategoryResponseSchema },
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
                return status(409, { error: code, message: 'Category still has products' })
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
