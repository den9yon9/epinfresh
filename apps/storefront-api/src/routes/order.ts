import { checkout } from '@epinfresh/checkout'
import { CreateOrderInputSchema } from '@epinfresh/checkout/model'
import { getOrderForUser, listOrdersByUser } from '@epinfresh/order'
import * as OrderModel from '@epinfresh/order/model'
import { cancelOrder } from '@epinfresh/order-cancel'
import { listPaymentsByOrder } from '@epinfresh/payment'
import * as PaymentModel from '@epinfresh/payment/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createOrderRoutes(plugins: StorefrontPlugins) {
  return new Elysia({ name: 'order-storefront' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .post(
      '/orders',
      async ({ body, headers, session, db }) => {
        const result = await checkout(
          { ...body, userId: session.userId, idempotencyKey: headers['idempotency-key'] },
          db,
        )
        return result.match(
          ({ order, replayed }) => status(replayed ? 200 : 201, order),
          (e) => {
            switch (e) {
              case 'SKU_NOT_FOUND':
                return status(404, { error: e, message: 'SKU not found' })
              case 'PRODUCT_UNAVAILABLE':
                return status(409, { error: e, message: 'Product not available' })
              case 'INSUFFICIENT_STOCK':
                return status(409, { error: e, message: 'Insufficient stock' })
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: e, message: 'Address not found' })
              default:
                return assertNever(e)
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
        detail: {
          tags: ['Orders'],
          summary: '结算下单',
          description:
            '从购物车或直接按 SKU 结算创建订单。\n\n- 需要登录\n- 幂等：携带相同 `Idempotency-Key` 头重复请求返回 200 与原订单，首次下单返回 201\n- SKU 或地址不存在返回 404\n- 商品未上架或库存不足返回 409',
        },
      },
    )
    .get('/orders', async ({ query, session, db }) => listOrdersByUser(session.userId, query, db), {
      isAuth: true,
      query: OrderModel.OrderListQuerySchema,
      response: { 200: OrderModel.OrderListResponseSchema },
      detail: {
        tags: ['Orders'],
        summary: '订单列表',
        description: '获取当前登录用户的订单列表，支持分页与状态筛选。\n\n- 需要登录',
      },
    })
    .get(
      '/orders/:id',
      async ({ params, session, db }) => {
        const result = await getOrderForUser(session.userId, params.id, db)
        return result.match(
          (order) => order,
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Orders'],
          summary: '订单详情',
          description:
            '按 ID 获取当前登录用户的订单详情。\n\n- 需要登录\n- 订单不存在或不属于当前用户返回 404',
        },
      },
    )
    .post(
      '/orders/:id/cancel',
      async ({ params, session, db }) => {
        const ownership = await getOrderForUser(session.userId, params.id, db)
        if (ownership.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        const result = await cancelOrder(params.id, db)
        return result.match(
          (order) => order,
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              case 'INVALID_TRANSITION':
                return status(409, { error: e, message: 'Order cannot be cancelled' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse, 409: ErrorResponse },
        detail: {
          tags: ['Orders'],
          summary: '取消订单',
          description:
            '取消当前用户的待支付/已支付订单，回滚库存并触发退款。\n\n- 需要登录，且订单必须属于当前用户\n- 订单不存在返回 404\n- 状态不允许取消返回 409',
        },
      },
    )
    .get(
      '/orders/:id/payments',
      async ({ params, session, db }) => {
        const ownership = await getOrderForUser(session.userId, params.id, db)
        if (ownership.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        const result = await listPaymentsByOrder(params.id, db)
        return result
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: PaymentModel.PaymentListResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Orders'],
          summary: '订单支付记录',
          description:
            '获取当前登录用户指定订单的支付记录列表。\n\n- 需要登录，且订单必须属于当前用户\n- 订单不存在或不属于当前用户返回 404',
        },
      },
    )
}
