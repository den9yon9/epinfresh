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
        detail: {
          tags: ['Addresses'],
          summary: '创建收货地址',
          description: '为当前登录用户创建收货地址，返回创建结果。\n\n- 需要登录',
        },
      },
    )
    .get('/addresses', async ({ session, db }) => listAddressesByUser(session.userId, db), {
      isAuth: true,
      response: { 200: AddressModel.AddressListResponseSchema },
      detail: {
        tags: ['Addresses'],
        summary: '收货地址列表',
        description: '获取当前登录用户的全部收货地址。\n\n- 需要登录',
      },
    })
    .get(
      '/addresses/:id',
      async ({ params, session, db }) => {
        const result = await getAddressById(session.userId, params.id, db)
        return result.match(
          (address) => address,
          (e) => {
            switch (e.code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: e.code, message: 'Address not found' })
              default:
                return assertNever(e.code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: AddressModel.AddressResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Addresses'],
          summary: '收货地址详情',
          description:
            '按 ID 获取当前用户的某个收货地址。\n\n- 需要登录\n- 地址不存在或不属于当前用户返回 404',
        },
      },
    )
    .put(
      '/addresses/:id',
      async ({ params, body, session, db }) => {
        const result = await updateAddress(session.userId, params.id, body, db)
        return result.match(
          (address) => address,
          (e) => {
            switch (e.code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: e.code, message: 'Address not found' })
              default:
                return assertNever(e.code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: AddressModel.UpdateAddressInputSchema,
        response: { 200: AddressModel.AddressResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Addresses'],
          summary: '更新收货地址',
          description:
            '更新当前用户的某个收货地址。\n\n- 需要登录\n- 地址不存在或不属于当前用户返回 404',
        },
      },
    )
    .delete(
      '/addresses/:id',
      async ({ params, session, db }) => {
        const result = await deleteAddress(session.userId, params.id, db)
        return result.match(
          () => status(204),
          (e) => {
            switch (e.code) {
              case 'ADDRESS_NOT_FOUND':
                return status(404, { error: e.code, message: 'Address not found' })
              default:
                return assertNever(e.code)
            }
          },
        )
      },
      {
        isAuth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 404: ErrorResponse },
        detail: {
          tags: ['Addresses'],
          summary: '删除收货地址',
          description:
            '删除当前用户的某个收货地址。\n\n- 需要登录\n- 成功返回 204 无返回体\n- 地址不存在或不属于当前用户返回 404',
        },
      },
    )
}
