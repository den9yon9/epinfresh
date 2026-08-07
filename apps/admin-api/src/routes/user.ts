import { commonModel } from '@epinfresh/http'
import { ErrorResponse } from '@epinfresh/shared'
import { getUserById, listUsers } from '@epinfresh/user'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status, t } from 'elysia'

import { adminResponse } from '../common'
import { type AdminPlugins } from '../plugins'

export function createUserRoutes(plugins: AdminPlugins) {
  return new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
    .use(commonModel)
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .get('/users', ({ query, db }) => listUsers(query, db), {
      isAdmin: true,
      query: UserModel.UserListQuerySchema,
      response: { 200: UserModel.UserListResponseSchema, ...adminResponse },
      detail: { tags: ['Admin/Users'] },
    })
    .get(
      '/users/:id',
      async ({ params, db }) => {
        const result = await getUserById(params.id, db)
        return result.match(
          (user) => user,
          (code) => {
            switch (code) {
              case 'USER_NOT_FOUND':
                return status(404, { error: code, message: 'User not found' })
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: UserModel.UserResponseSchema, 404: ErrorResponse, ...adminResponse },
        detail: { tags: ['Admin/Users'] },
      },
    )
}
