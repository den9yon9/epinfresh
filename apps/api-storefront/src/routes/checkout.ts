import { checkoutWorkflow } from '@epinfresh/checkout'
import { commonModel } from '@epinfresh/http'
import { PRODUCT_ERRORS } from '@epinfresh/product'
import { Elysia, status, t } from 'elysia'
import { storeDb, storeSession } from '../plugins'

export const checkoutRoutes = new Elysia({ name: 'checkout', prefix: '/api/v1' })
  .use(commonModel)
  .use(storeDb)
  .use(storeSession)
  .post(
    '/checkout',
    async ({ body, session, db }) => {
      const result = await checkoutWorkflow({ ...body, userId: session.userId }, db)
      return result.match(
        () => status(201),
        (code) =>
          status(PRODUCT_ERRORS[code].status, {
            error: code,
            message: PRODUCT_ERRORS[code].message,
          }),
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
