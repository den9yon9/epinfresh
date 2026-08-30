import {
  COURIER_COMPANIES,
  getTrackByOrderId,
  LogisticsTrackResponseSchema,
  toTrackResponse,
} from '@epinfresh/logistics'
import {
  completeOrder,
  getOrderById,
  getOrderStatusCounts,
  listOrders,
  shipOrder,
  updateOrderStatus,
} from '@epinfresh/order'
import * as OrderModel from '@epinfresh/order/model'
import { cancelOrder } from '@epinfresh/order-cancel'
import { insertOutboxEvent } from '@epinfresh/outbox'
import { listPaymentsByOrder } from '@epinfresh/payment'
import * as PaymentModel from '@epinfresh/payment/model'
import { refundOrderWorkflow } from '@epinfresh/payment-refund'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type AdminPlugins } from '../plugins'

export function createOrderRoutes(plugins: AdminPlugins) {
  const { paymentGateways } = plugins
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
        // 特例分发: cancelled 走取消流程(回滚库存并退款/通知), completed 走
        // completeOrder 同事务写 completed_at; 其余走通用状态机 PATCH。
        const result =
          body.status === 'cancelled'
            ? await cancelOrder(params.id, paymentGateways, db)
            : body.status === 'completed'
              ? await completeOrder(params.id, db)
              : (await updateOrderStatus(params.id, body.status, db)).map(({ order }) => order)
        return result.match(
          (order) => order,
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              case 'INVALID_TRANSITION':
                return status(409, { error: e, message: 'Invalid status transition' })
              case 'GATEWAY_ERROR':
                return status(502, { error: e, message: 'Refund gateway error' })
              case 'UNSUPPORTED_CHANNEL':
                return status(400, { error: e, message: 'Channel does not support refunds' })
              default:
                return assertNever(e)
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
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
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
        // app 层注入 outbox 事件写入(order 域不依赖 outbox): 仅 paid → shipped 转变时触发
        const result = await shipOrder(params.id, body.trackingNumber, body.courierCompany, db, {
          onShipped: (tx, event) =>
            insertOutboxEvent(tx, {
              eventType: 'order.shipped',
              aggregateType: 'order',
              aggregateId: event.orderId,
              payload: {
                orderId: event.orderId,
                trackingNumber: event.trackingNumber,
                shippedAt: event.shippedAt,
                courierCompany: event.courierCompany,
              },
            }),
        })
        return result.match(
          (order) => order,
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              case 'SHIPMENT_INFO_INCOMPLETE':
                return status(400, {
                  error: e,
                  message: '承运商与运单号需同时填写，或都留空（后补）',
                })
              case 'INVALID_TRANSITION':
                return status(409, { error: e, message: 'Order cannot be shipped' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({
          trackingNumber: t.Optional(t.String({ maxLength: 100 })),
          courierCompany: t.Optional(t.Union(COURIER_COMPANIES.map((c) => t.Literal(c)))),
        }),
        response: {
          200: OrderModel.OrderResponseSchema,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单发货',
          description:
            '将订单标记为已发货并填写运单号与承运商（指定承运商后 worker 将轮询轨迹，签收自动完成订单）。\n\n- 需要 admin 角色\n- 承运商与运单号需同时填写或都留空（首次发货校验；已发货订单可部分更新补录）\n- 幂等：已发货的订单重复调用仅更新运单号/承运商\n- 订单不存在返回 404\n- 状态不允许发货返回 409，承运商/运单号只填其一返回 400',
        },
      },
    )
    .get(
      '/orders/:id/track',
      async ({ params, db }) => {
        const order = await getOrderById(params.id, db)
        if (order.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        const track = await getTrackByOrderId(params.id, db)
        return { track: track ? toTrackResponse(track) : null }
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: t.Object({ track: t.Union([LogisticsTrackResponseSchema, t.Null()]) }),
          404: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单物流轨迹',
          description:
            '获取订单的物流轨迹快照（worker 轮询落库），无轨迹时返回 null。\n\n- 需要 admin 角色',
        },
      },
    )
    .post(
      '/orders/:id/refund',
      async ({ params, db }) => {
        const result = await refundOrderWorkflow(params.id, paymentGateways, db)
        return result.match(
          ({ payment }) => payment,
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              case 'NO_REFUNDABLE_PAYMENT':
                return status(404, { error: e, message: 'No refundable payment' })
              case 'INVALID_PAYMENT_STATE':
                return status(409, { error: e, message: 'Order cannot be refunded' })
              case 'GATEWAY_ERROR':
                return status(502, { error: e, message: 'Refund gateway error' })
              case 'UNSUPPORTED_CHANNEL':
                return status(400, { error: e, message: 'Channel does not support refunds' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: PaymentModel.PaymentResponseSchema,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
        detail: {
          tags: ['Admin/Orders'],
          summary: '订单退款',
          description:
            '向支付渠道提交退款并标记订单/支付单为已退款。\n\n- 需要 admin 角色\n- 退款先经渠道网关提交，渠道失败返回 502 且不改本地状态\n- 订单不存在或无可退支付返回 404，状态不允许退款返回 409，渠道不支持退款返回 400',
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
