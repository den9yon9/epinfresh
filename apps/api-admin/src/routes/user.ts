import { ErrorResponse, commonModel, toError } from '@epinfresh/shared'
import {
  USER_ERRORS,
  UserListQuerySchema,
  UserListResponseSchema,
  UserResponseSchema,
  getUserById,
  listUsers,
} from '@epinfresh/user'
import { Elysia, status, t } from 'elysia'
import { adminResponse } from '../common'
import { adminDb, adminSession } from '../plugins'

export const userRoutes = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
  .use(commonModel)
  .use(adminDb)
  .use(adminSession)
  .get('/users', ({ query, db }) => listUsers(query, db), {
    isAdmin: true,
    query: UserListQuerySchema,
    response: { 200: UserListResponseSchema, ...adminResponse },
    detail: { tags: ['Admin/Users'] },
  })
  .get(
    '/users/:id',
    async ({ params, db }) => {
      const result = await getUserById(params.id, db)
      return result.match(
        (user) => user,
        (code) => toError(USER_ERRORS, code),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: UserResponseSchema, 404: ErrorResponse, ...adminResponse },
      detail: { tags: ['Admin/Users'] },
    },
  )
