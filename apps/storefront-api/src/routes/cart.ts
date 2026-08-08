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
      detail: { tags: ['Cart'] },
    })
    .post(
      '/cart/items',
      async ({ body, session, db }) => {
        const result = await addToCart(session.userId, body.skuId, body.quantity, db)
        return result.match(
          (item) => status(201, item),
          (code) => {
            switch (code) {
              case 'SKU_NOT_FOUND':
                return status(404, { error: code, message: 'SKU not found' })
              case 'PRODUCT_UNAVAILABLE':
                return status(409, { error: code, message: 'Product not available' })
              default:
                return assertNever(code)
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
        detail: { tags: ['Cart'] },
      },
    )
    .put(
      '/cart/items/:skuId',
      async ({ params, body, session, db }) => {
        const result = await updateCartItem(session.userId, params.skuId, body.quantity, db)
        return result.match(
          (item) => item,
          (code) => {
            switch (code) {
              case 'CART_ITEM_NOT_FOUND':
                return status(404, { error: code, message: 'Cart item not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ skuId: t.String({ format: 'uuid' }) }),
        body: CartModel.UpdateCartItemInputSchema,
        response: { 200: CartModel.CartItemResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Cart'] },
      },
    )
    .delete(
      '/cart/items/:skuId',
      async ({ params, session, db }) => {
        const result = await removeCartItem(session.userId, params.skuId, db)
        return result.match(
          () => status(204),
          (code) => {
            switch (code) {
              case 'CART_ITEM_NOT_FOUND':
                return status(404, { error: code, message: 'Cart item not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ skuId: t.String({ format: 'uuid' }) }),
        response: { 404: ErrorResponse },
        detail: { tags: ['Cart'] },
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
        detail: { tags: ['Cart'] },
      },
    )
}
