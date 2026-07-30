import { sessionPlugin } from '@epinfresh/session'
import { commonModel } from '@epinfresh/shared'
import { getUserById, listUsers, userModel } from '@epinfresh/user'
import { Elysia, status, t } from 'elysia'

const adminResponse = { 401: 'ErrorResponse', 403: 'ErrorResponse' } as const

export const userRoutes = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
  .use(userModel)
  .use(commonModel)
  .use(sessionPlugin)
  .get('/users', ({ query }) => listUsers(query), {
    isAdmin: true,
    query: 'UserListQuery',
    response: { 200: 'UserListResponse', ...adminResponse },
    detail: { tags: ['Admin/Users'] },
  })
  .get(
    '/users/:id',
    async ({ params }) => {
      const result = await getUserById(params.id)
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
