import {
  createCategory,
  createProduct,
  getProductById,
  listAllProducts,
  listCategories,
  removeCategory,
  removeProduct,
  updateCategory,
  updateProduct,
} from '@epinfresh/product'
import * as ProductModel from '@epinfresh/product/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
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
      detail: {
        tags: ['Admin/Products'],
        summary: '商品列表',
        description: '全部商品列表（含未上架），支持分页与筛选。\n\n- 需要 admin 角色',
      },
    })
    .get(
      '/products/:id',
      async ({ params, db }) => {
        const result = await getProductById(params.id, db)
        return result.match(
          (p) => p,
          (e) => {
            switch (e) {
              case 'PRODUCT_NOT_FOUND':
                return status(404, { error: e, message: 'Product not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Admin/Products'],
          summary: '商品详情',
          description: '按 ID 获取商品详情（含 SKU）。\n\n- 需要 admin 角色\n- 商品不存在返回 404',
        },
      },
    )
    .post('/products', async ({ body, db }) => status(201, await createProduct(body, db)), {
      isAdmin: true,
      body: ProductModel.CreateProductInputSchema,
      response: { 201: ProductModel.ProductResponseSchema },
      detail: {
        tags: ['Admin/Products'],
        summary: '创建商品',
        description: '创建商品及其 SKU。\n\n- 需要 admin 角色\n- 成功返回 201',
      },
    })
    .put(
      '/products/:id',
      async ({ params, body, db }) => {
        const result = await updateProduct(params.id, body, db)
        return result.match(
          (p) => p,
          (e) => {
            switch (e) {
              case 'PRODUCT_NOT_FOUND':
                return status(404, { error: e, message: 'Product not found' })
              case 'SKU_NOT_FOUND':
                return status(404, { error: e, message: 'SKU not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: ProductModel.UpdateProductInputSchema,
        response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Admin/Products'],
          summary: '更新商品',
          description: '更新商品信息及 SKU。\n\n- 需要 admin 角色\n- 商品或 SKU 不存在返回 404',
        },
      },
    )
    .delete(
      '/products/:id',
      async ({ params, db }) => {
        const result = await removeProduct(params.id, db)
        return result.match(
          () => status(204),
          (e) => {
            switch (e) {
              case 'PRODUCT_NOT_FOUND':
                return status(404, { error: e, message: 'Product not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          tags: ['Admin/Products'],
          summary: '删除商品',
          description:
            '删除商品及其 SKU。\n\n- 需要 admin 角色\n- 成功返回 204 无返回体\n- 商品不存在返回 404',
        },
      },
    )
    .get('/categories', ({ query, db }) => listCategories(query, db), {
      isAdmin: true,
      query: ProductModel.CategoryListQuerySchema,
      response: { 200: ProductModel.CategoryListResponseSchema },
      detail: {
        tags: ['Admin/Categories'],
        summary: '分类列表',
        description: '商品分类列表。\n\n- 需要 admin 角色',
      },
    })
    .post('/categories', async ({ body, db }) => status(201, await createCategory(body, db)), {
      isAdmin: true,
      body: ProductModel.CreateCategoryInputSchema,
      response: { 201: ProductModel.CategoryResponseSchema },
      detail: {
        tags: ['Admin/Categories'],
        summary: '创建分类',
        description: '创建商品分类。\n\n- 需要 admin 角色\n- 成功返回 201',
      },
    })
    .delete(
      '/categories/:id',
      async ({ params, db }) => {
        const result = await removeCategory(params.id, db)
        return result.match(
          () => status(204),
          (e) => {
            switch (e) {
              case 'CATEGORY_NOT_FOUND':
                return status(404, { error: e, message: 'Category not found' })
              case 'CATEGORY_HAS_PRODUCTS':
                return status(409, { error: e, message: 'Category still has products' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          tags: ['Admin/Categories'],
          summary: '删除分类',
          description:
            '删除商品分类。\n\n- 需要 admin 角色\n- 成功返回 204 无返回体\n- 分类不存在返回 404\n- 分类下仍有商品返回 409',
        },
      },
    )
    .patch(
      '/categories/:id',
      async ({ params, body, db }) => {
        const result = await updateCategory(params.id, body, db)
        return result.match(
          (category) => category,
          (e) => {
            switch (e) {
              case 'CATEGORY_NOT_FOUND':
                return status(404, { error: e, message: 'Category not found' })
              case 'CATEGORY_PARENT_NOT_FOUND':
                return status(404, { error: e, message: 'Parent category not found' })
              case 'CATEGORY_CYCLE':
                return status(409, { error: e, message: 'Cannot set a descendant as parent' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: ProductModel.UpdateCategoryInputSchema,
        response: {
          200: ProductModel.CategoryResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Categories'],
          summary: '更新分类',
          description:
            '更新分类的名称、Slug、父级与排序。\n\n- 需要 admin 角色\n- 分类或父级不存在返回 404\n- 设置自身/子孙为父级返回 409',
        },
      },
    )
}
