import { getProductByIdPublic, listCategories, listPublishedProducts } from '@epinfresh/product'
import * as ProductModel from '@epinfresh/product/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createProductRoutes(plugins: StorefrontPlugins) {
  return new Elysia({ name: 'product-storefront' })
    .use(plugins.dbPlugin)
    .get('/products', async ({ query, db }) => listPublishedProducts(query, db), {
      query: ProductModel.ProductListQuerySchema,
      response: { 200: ProductModel.ProductListResponseSchema },
      detail: {
        tags: ['Products'],
        summary: '商品列表',
        description: '获取已上架商品列表，支持分类筛选、分页与排序。\n\n- 无需登录',
      },
    })
    .get(
      '/products/:id',
      async ({ params, db }) => {
        const result = await getProductByIdPublic(params.id, db)
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
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: ProductModel.ProductResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Products'],
          summary: '商品详情',
          description:
            '按 ID 获取已上架商品详情（含 SKU）。\n\n- 无需登录\n- 商品不存在或未上架返回 404',
        },
      },
    )
    .get('/categories', ({ query, db }) => listCategories(query, db), {
      query: ProductModel.CategoryListQuerySchema,
      response: { 200: ProductModel.CategoryListResponseSchema },
      detail: {
        tags: ['Categories'],
        summary: '分类列表',
        description: '获取商品分类列表。\n\n- 无需登录',
      },
    })
}
