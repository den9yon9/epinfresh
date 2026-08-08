import {
  createAddress,
  deleteAddress,
  getAddressById,
  listAddressesByUser,
  updateAddress,
} from '@epinfresh/address'
import * as AddressModel from '@epinfresh/address/model'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createAddressRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin } = plugins
  return new Elysia({ name: 'address-storefront' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .post(
      '/addresses',
      async ({ body, session, db }) => {
        const address = await createAddress({ ...body, userId: session.userId }, db)
        return status(201, address)
      },
      {
        isAuth: true,
        body: AddressModel.CreateAddressInputSchema,
        response: { 201: AddressModel.AddressResponseSchema },
        detail: { tags: ['Addresses'] },
      },
    )
    .get('/addresses', async ({ session, db }) => listAddressesByUser(session.userId, db), {
      isAuth: true,
      response: { 200: AddressModel.AddressListResponseSchema },
      detail: { tags: ['Addresses'] },
    })
    .get(
      '/addresses/:id',
      async ({ params, session, db }) => {
        const result = await getAddressById(session.userId, params.id, db)
        return result.match(
          (address) => address,
          (code) => {
            switch (code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: code, message: 'Address not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: AddressModel.AddressResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Addresses'] },
      },
    )
    .put(
      '/addresses/:id',
      async ({ params, body, session, db }) => {
        const result = await updateAddress(session.userId, params.id, body, db)
        return result.match(
          (address) => address,
          (code) => {
            switch (code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: code, message: 'Address not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: AddressModel.UpdateAddressInputSchema,
        response: { 200: AddressModel.AddressResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Addresses'] },
      },
    )
    .delete(
      '/addresses/:id',
      async ({ params, session, db }) => {
        const result = await deleteAddress(session.userId, params.id, db)
        return result.match(
          () => status(204),
          (code) => {
            switch (code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: code, message: 'Address not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 404: ErrorResponse },
        detail: { tags: ['Addresses'] },
      },
    )
}
