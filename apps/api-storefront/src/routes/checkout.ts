import { checkoutWorkflow } from '@epinfresh/checkout'
import { sessionPlugin } from '@epinfresh/session'
import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

export const checkoutRoutes = new Elysia({ name: 'checkout', prefix: '/api/v1' })
  .use(commonModel)
  .use(sessionPlugin)
  .post(
    '/checkout',
    async ({ body, session }) => {
      const result = await checkoutWorkflow({ ...body, userId: session.userId })
      return result.match(
        () => status(201),
        (code) => {
          switch (code) {
            case 'SKU_NOT_FOUND':
              return status(404, { error: code, message: 'SKU not found' })
            case 'INSUFFICIENT_STOCK':
              return status(409, { error: code, message: 'Insufficient stock' })
          }
        },
      )
    },
    {
      isAuth: true,
      body: t.Object({
        skuId: t.String({ format: 'uuid' }),
        quantity: t.Number({ minimum: 1, maximum: 9999 }),
      }),
      detail: { tags: ['Checkout'] },
    },
  )
