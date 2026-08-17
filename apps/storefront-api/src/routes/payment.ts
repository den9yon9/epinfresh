import { getOrderForUser } from '@epinfresh/order'
import { getPaymentById, initiatePayment, type WebhookEvent } from '@epinfresh/payment'
import * as PaymentModel from '@epinfresh/payment/model'
import { confirmByWebhookEvent } from '@epinfresh/payment-confirm'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

// 渠道注册表键; 与 gateway 契约的 PaymentChannel 保持一致
const paymentChannelSchema = t.Union([t.Literal('mock'), t.Literal('wechat'), t.Literal('alipay')])

const payBodySchema = t.Object({
  channel: paymentChannelSchema,
  // 渠道上下文不透明透传(如微信 JSAPI 的 openid); 核心只转发不解析
  channelContext: t.Optional(t.Record(t.String(), t.Unknown())),
})

export function createPaymentRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin, paymentGateways } = plugins
  return new Elysia({ name: 'payment-storefront' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .post(
      '/orders/:id/pay',
      async ({ params, session, body, db }) => {
        const ownership = await getOrderForUser(session.userId, params.id, db)
        if (ownership.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        const gateway = paymentGateways[body.channel]
        if (!gateway) {
          return status(400, {
            error: 'PAYMENT_CHANNEL_NOT_CONFIGURED',
            message: 'Payment channel not configured',
          })
        }
        const result = await initiatePayment(params.id, gateway, db, body.channelContext)
        return result.match(
          (value) => status(201, value),
          (e) => {
            switch (e) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Order not found' })
              case 'ORDER_NOT_PENDING':
                return status(409, { error: e, message: 'Order is not payable' })
              case 'GATEWAY_ERROR':
                return status(502, { error: e, message: 'Payment gateway error' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: payBodySchema,
        response: {
          201: PaymentModel.PaymentInitiateResponseSchema,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
        detail: {
          tags: ['Payments'],
          summary: '发起支付',
          description:
            '按渠道为指定订单发起支付，返回支付单与渠道载荷(payload)。\n\n- 需要登录，且订单必须属于当前用户\n- 渠道未配置返回 400，订单不存在返回 404，订单非待支付返回 409',
        },
      },
    )
    .post(
      '/payments/:id/confirm',
      async ({ params, session, db }) => {
        const payment = await getPaymentById(params.id, db)
        if (payment.isErr()) {
          return status(404, { error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' })
        }
        const ownership = await getOrderForUser(session.userId, payment.value.orderId, db)
        if (ownership.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        // ponytail: mock 网关回调入口; 模拟渠道成功回调, 走与真实 webhook 相同的幂等管线。
        // 接入真实网关后此端点废弃, 由 /payments/notify/:channel 替代。
        const event: WebhookEvent = {
          channel: 'mock',
          eventId: crypto.randomUUID(),
          outTradeNo: payment.value.outTradeNo,
          providerTransactionId: payment.value.providerRef ?? undefined,
          amount: payment.value.amount,
          status: 'succeeded',
        }
        const result = await confirmByWebhookEvent(event, db)
        return result.match(
          (value) => status(200, value?.payment ?? payment.value),
          (e) => {
            switch (e) {
              case 'PAYMENT_NOT_FOUND':
              case 'ORDER_NOT_FOUND':
                return status(404, { error: e, message: 'Payment or order not found' })
              case 'AMOUNT_MISMATCH':
                return status(400, { error: e, message: 'Payment amount mismatch' })
              case 'INVALID_PAYMENT_STATE':
                return status(409, { error: e, message: 'Payment cannot be confirmed' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        // ponytail: mock 网关回调入口；接入真实网关后由 webhook handler 替代
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: PaymentModel.PaymentResponseSchema,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: {
          tags: ['Payments'],
          summary: '确认支付（mock）',
          description:
            '确认支付成功（当前为 mock 支付网关的回调入口，接入真实网关后由 webhook 替代）。幂等：重复确认返回 200。\n\n- 需要登录，且支付单对应的订单必须属于当前用户',
        },
      },
    )
    .post(
      '/payments/notify/:channel',
      async ({ params, headers, body, db }) => {
        const gateway = paymentGateways[params.channel]
        if (!gateway) {
          return status(400, 'FAIL')
        }
        // parse hook 将原始 body 作为字符串传入(见下方 parse), 验签必须用未改动的原文
        const verified = await gateway.verifyWebhook({ headers, rawBody: body as string })
        if (verified.isErr()) {
          return status(400, 'FAIL')
        }
        const result = await confirmByWebhookEvent(verified.value, db)
        if (result.isErr()) {
          // 校验失败不回成功应答, 让渠道平台稍后重试
          return status(400, 'FAIL')
        }
        return gateway.notifySuccessBody
      },
      {
        // 公共回调入口, 无登录; 渠道平台直接调用
        type: 'text/plain',
        // 微信/支付宝回调一律 application/json; 强制按原文文本解析, 避免 Elysia 按 content-type 转成对象
        parse: ({ request }) => request.text(),
        params: t.Object({ channel: paymentChannelSchema }),
        response: {
          200: t.String(),
          400: t.String(),
        },
        detail: {
          tags: ['Payments'],
          summary: '支付渠道回调',
          description:
            '渠道平台支付结果回调入口。按 channel 分发到对应网关做签名校验，成功后按渠道要求的应答体返回（微信 SUCCESS / 支付宝 success）。',
        },
      },
    )
}
