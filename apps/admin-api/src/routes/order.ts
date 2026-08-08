import { schema } from '@epinfresh/database'
import { getOrderById, getOrderStatusCounts, listOrders, updateOrderStatus } from '@epinfresh/order'
import * as OrderModel from '@epinfresh/order/model'
import { cancelOrder } from '@epinfresh/order-cancel'
import { listPaymentsByOrder, refundOrder } from '@epinfresh/payment'
import * as PaymentModel from '@epinfresh/payment/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { eq } from 'drizzle-orm'
import { Elysia, status, t } from 'elysia'

import { type AdminPlugins } from '../plugins'

export function createOrderRoutes(plugins: AdminPlugins) {
  return new Elysia({ name: 'order-admin', prefix: '/admin' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .get('/dashboard', ({ db }) => getOrderStatusCounts(db), {
      isAdmin: true,
      response: { 200: OrderModel.DashboardResponseSchema },
      detail: {
        tags: ['Admin/Dashboard'],
        summary: '订单状态统计',
        description: '各订单状态的数量统计，用于管理后台首页。\n\n- 需要 admin 角色',
      },
    })
    .get('/orders', ({ query, db }) => listOrders(query, db), {
      isAdmin: true,
      query: OrderModel.AdminOrderListQuerySchema,
      response: { 200: OrderModel.OrderListResponseSchema },
      detail: {
        tags: ['Admin/Orders'],
        summary: '订单列表',
        description: '全部订单列表，支持状态、时间筛选与分页。\n\n- 需要 admin 角色',
      },
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
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单详情',
          description:
            '按 ID 获取订单详情（含商品明细）。\n\n- 需要 admin 角色\n- 订单不存在返回 404',
        },
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
              default:
                return assertNever(code)
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
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '更新订单状态',
          description:
            '更新订单状态。状态为 `cancelled` 时走取消流程（回滚库存并触发退款/通知）。\n\n- 需要 admin 角色\n- 订单不存在返回 404\n- 非法状态流转返回 409',
        },
      },
    )
    .post(
      '/orders/:id/ship',
      async ({ params, body, db }) => {
        const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, params.id))
        if (!order) return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })

        if (order.status !== 'shipped') {
          const result = await updateOrderStatus(params.id, 'shipped', db)
          if (result.isErr()) {
            return status(409, { error: 'INVALID_TRANSITION', message: 'Order cannot be shipped' })
          }
        }
        // 已 shipped 时重复调用仅补/更运单号（幂等）
        const [updated] = await db
          .update(schema.orders)
          .set({
            trackingNumber: body.trackingNumber ?? order.trackingNumber,
            shippedAt: order.shippedAt ?? new Date(),
          })
          .where(eq(schema.orders.id, params.id))
          .returning()
        const items = await db
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, params.id))
        return { ...updated, items }
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({ trackingNumber: t.Optional(t.String({ maxLength: 100 })) }),
        response: {
          200: OrderModel.OrderResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单发货',
          description:
            '将订单标记为已发货并填写运单号。\n\n- 需要 admin 角色\n- 幂等：已发货的订单重复调用仅更新运单号\n- 订单不存在返回 404\n- 状态不允许发货返回 409',
        },
      },
    )
    .post(
      '/orders/:id/refund',
      async ({ params, db }) => {
        const result = await refundOrder(params.id, db)
        return result.match(
          (payment) => payment,
          (code) => {
            switch (code) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: code, message: 'Order not found' })
              case 'NO_REFUNDABLE_PAYMENT':
                return status(404, { error: code, message: 'No refundable payment' })
              case 'INVALID_PAYMENT_STATE':
                return status(409, { error: code, message: 'Order cannot be refunded' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: PaymentModel.PaymentResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单退款',
          description:
            '对已支付订单发起退款，返回退款支付单。\n\n- 需要 admin 角色\n- 订单不存在或无可退支付返回 404\n- 支付状态不允许退款返回 409',
        },
      },
    )
    .get(
      '/orders/:id/payments',
      async ({ params, db }) => {
        const order = await getOrderById(params.id, db)
        if (order.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        return listPaymentsByOrder(params.id, db)
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: PaymentModel.PaymentListResponseSchema,
          404: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Payments'],
          summary: '订单支付记录',
          description:
            '获取指定订单的全部支付记录（含退款）。\n\n- 需要 admin 角色\n- 订单不存在返回 404',
        },
      },
    )
}
