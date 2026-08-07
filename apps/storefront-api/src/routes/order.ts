import { checkoutWorkflow } from '@epinfresh/checkout'
import { CreateOrderInputSchema } from '@epinfresh/checkout/model'
import { getOrderForUser, listOrdersByUser } from '@epinfresh/order'
import * as OrderModel from '@epinfresh/order/model'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createOrderRoutes(plugins: StorefrontPlugins) {
  return new Elysia({ name: 'order-storefront', prefix: '/api/v1' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .post(
      '/orders',
      async ({ body, headers, session, db }) => {
        const result = await checkoutWorkflow(
          { ...body, userId: session.userId, idempotencyKey: headers['idempotency-key'] },
          db,
        )
        return result.match(
          ({ order, replayed }) => status(replayed ? 200 : 201, order),
          (code) => {
            switch (code) {
              case 'SKU_NOT_FOUND':
                return status(404, { error: code, message: 'SKU not found' })
              case 'PRODUCT_UNAVAILABLE':
                return status(409, { error: code, message: 'Product not available' })
              case 'INSUFFICIENT_STOCK':
                return status(409, { error: code, message: 'Insufficient stock' })
            }
          },
        )
      },
      {
        isAuth: true,
        body: CreateOrderInputSchema,
        headers: t.Object({ 'idempotency-key': t.Optional(t.String()) }),
        response: {
          200: OrderModel.OrderResponseSchema,
          201: OrderModel.OrderResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: { tags: ['Orders'] },
      },
    )
    .get('/orders', async ({ query, session, db }) => listOrdersByUser(session.userId, query, db), {
      isAuth: true,
      query: OrderModel.OrderListQuerySchema,
      response: { 200: OrderModel.OrderListResponseSchema },
      detail: { tags: ['Orders'] },
    })
    .get(
      '/orders/:id',
      async ({ params, session, db }) => {
        const result = await getOrderForUser(session.userId, params.id, db)
        return result.match(
          (order) => order,
          (code) => {
            switch (code) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: code, message: 'Order not found' })
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Orders'] },
      },
    )
}
