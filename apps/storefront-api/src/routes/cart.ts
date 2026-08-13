import { addToCart, clearCart, listCart, removeCartItem, updateCartItem } from '@epinfresh/cart'
import * as CartModel from '@epinfresh/cart/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createCartRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin } = plugins
  return new Elysia({ name: 'cart-storefront' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .get('/cart', async ({ session, db }) => listCart(session.userId, db), {
      isAuth: true,
      response: { 200: CartModel.CartListResponseSchema },
      detail: {
        tags: ['Cart'],
        summary: '查看购物车',
        description: '获取当前登录用户的购物车，含商品明细与数量。\n\n- 需要登录',
      },
    })
    .post(
      '/cart/items',
      async ({ body, session, db }) => {
        const result = await addToCart(session.userId, body.skuId, body.quantity, db)
        return result.match(
          (item) => status(201, item),
          (e) => {
            switch (e) {
              case 'SKU_NOT_FOUND':
                return status(404, { error: e, message: 'SKU not found' })
              case 'PRODUCT_UNAVAILABLE':
                return status(409, { error: e, message: 'Product not available' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        body: CartModel.AddCartItemInputSchema,
        response: {
          201: CartModel.CartItemResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Cart'],
          summary: '添加商品到购物车',
          description:
            '将指定 SKU 加入当前登录用户的购物车。\n\n- 需要登录\n- SKU 不存在返回 404\n- 商品未上架返回 409',
        },
      },
    )
    .put(
      '/cart/items/:skuId',
      async ({ params, body, session, db }) => {
        const result = await updateCartItem(session.userId, params.skuId, body.quantity, db)
        return result.match(
          (item) => item,
          (e) => {
            switch (e) {
              case 'CART_ITEM_NOT_FOUND':
                return status(404, { error: e, message: 'Cart item not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ skuId: t.String({ format: 'uuid' }) }),
        body: CartModel.UpdateCartItemInputSchema,
        response: { 200: CartModel.CartItemResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Cart'],
          summary: '更新购物车商品数量',
          description: '更新购物车中某个 SKU 的数量。\n\n- 需要登录\n- 该 SKU 不在购物车中返回 404',
        },
      },
    )
    .delete(
      '/cart/items/:skuId',
      async ({ params, session, db }) => {
        const result = await removeCartItem(session.userId, params.skuId, db)
        return result.match(
          () => status(204),
          (e) => {
            switch (e) {
              case 'CART_ITEM_NOT_FOUND':
                return status(404, { error: e, message: 'Cart item not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ skuId: t.String({ format: 'uuid' }) }),
        response: { 404: ErrorResponse },
        detail: {
          tags: ['Cart'],
          summary: '移除购物车商品',
          description:
            '将某个 SKU 从购物车中移除。\n\n- 需要登录\n- 成功返回 204 无返回体\n- 该 SKU 不在购物车中返回 404',
        },
      },
    )
    .delete(
      '/cart',
      async ({ session, db }) => {
        await clearCart(session.userId, db)
        return status(204)
      },
      {
        isAuth: true,
        detail: {
          tags: ['Cart'],
          summary: '清空购物车',
          description: '清空当前登录用户的全部购物车商品。\n\n- 需要登录\n- 成功返回 204 无返回体',
        },
      },
    )
}
