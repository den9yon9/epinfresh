import { sessionPlugin } from '@epinfresh/session'
import { commonModel } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

const adminResponse = { 401: 'ErrorResponse', 403: 'ErrorResponse' } as const

export const userAdminPlugin = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
  .use(userModel)
  .use(commonModel)
  .use(sessionPlugin)
  .get('/users', ({ query }) => UserService.list(query), {
    isAdmin: true,
    query: 'UserListQuery',
    response: { 200: 'UserListResponse', ...adminResponse },
    detail: { tags: ['Admin/Users'] },
  })
  .get(
    '/users/:id',
    async ({ params }) => {
      const result = await UserService.getById(params.id)
      return result.match(
        (user) => user,
        (code) => status(404, { error: code, message: 'User not found' }),
      )
    },
    {
      isAdmin: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: 'UserResponse', 404: 'ErrorResponse', ...adminResponse },
      detail: { tags: ['Admin/Users'] },
    },
  )
