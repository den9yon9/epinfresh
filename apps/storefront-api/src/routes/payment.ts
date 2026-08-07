import { getOrderForUser } from '@epinfresh/order'
import { confirmPayment, getPaymentById, initiatePayment } from '@epinfresh/payment'
import * as PaymentModel from '@epinfresh/payment/model'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createPaymentRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin, paymentGateway } = plugins
  return new Elysia({ name: 'payment-storefront' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .post(
      '/orders/:id/pay',
      async ({ params, session, db }) => {
        const ownership = await getOrderForUser(session.userId, params.id, db)
        if (ownership.isErr()) {
          return status(404, { error: 'ORDER_NOT_FOUND', message: 'Order not found' })
        }
        const result = await initiatePayment(params.id, paymentGateway, db)
        return result.match(
          (payment) => status(201, payment),
          (code) => {
            switch (code) {
              case 'ORDER_NOT_FOUND':
                return status(404, { error: code, message: 'Order not found' })
              case 'ORDER_NOT_PENDING':
                return status(409, { error: code, message: 'Order is not payable' })
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          201: PaymentModel.PaymentResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: { tags: ['Payments'] },
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
        const result = await confirmPayment(params.id, db)
        return result.match(
          ({ payment: confirmed }) => status(200, confirmed),
          (code) => {
            switch (code) {
              case 'PAYMENT_NOT_FOUND':
                return status(404, { error: code, message: 'Payment not found' })
              case 'INVALID_PAYMENT_STATE':
                return status(409, { error: code, message: 'Payment cannot be confirmed' })
            }
          },
        )
      },
      {
        // ponytail: mock 网关回调入口；接真实网关时此处换成 webhook 签名校验 handler
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: PaymentModel.PaymentResponseSchema,
          404: ErrorResponse,
          409: ErrorResponse,
        },
        detail: { tags: ['Payments'] },
      },
    )
}
