import { commonModel } from '@epinfresh/http'
import { getOrderById, listOrders, updateOrderStatus } from '@epinfresh/order'
import * as OrderModel from '@epinfresh/order/model'
import { cancelOrder } from '@epinfresh/order-cancel'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { adminResponse } from '../common'
import { adminDb, adminSession } from '../plugins'

export const orderRoutes = new Elysia({ name: 'order-admin', prefix: '/api/v1/admin' })
  .use(commonModel)
  .use(adminDb)
  .use(adminSession)
  .get('/orders', ({ query, db }) => listOrders(query, db), {
    isAdmin: true,
    query: OrderModel.AdminOrderListQuerySchema,
    response: { 200: OrderModel.OrderListResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Orders'] },
  })
  .get(
    '/orders/:id',
    async ({ params, db }) => {
      const result = await getOrderById(params.id, db)
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
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse, ...adminResponse },
      detail: { tags: ['Admin/Orders'] },
    },
  )
  .patch(
    '/orders/:id/status',
    async ({ params, body, db }) => {
      const result =
        body.status === 'cancelled'
          ? await cancelOrder(params.id, db)
          : (await updateOrderStatus(params.id, body.status, db)).map(({ order }) => order)
      return result.match(
        (order) => order,
        (code) => {
          switch (code) {
            case 'ORDER_NOT_FOUND':
              return status(404, { error: code, message: 'Order not found' })
            case 'INVALID_TRANSITION':
              return status(409, { error: code, message: 'Invalid status transition' })
          }
        },
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: OrderModel.UpdateOrderStatusSchema,
      response: {
        200: OrderModel.OrderResponseSchema,
        404: ErrorResponse,
        409: ErrorResponse,
        ...adminResponse,
      },
      detail: { tags: ['Admin/Orders'] },
    },
  )
