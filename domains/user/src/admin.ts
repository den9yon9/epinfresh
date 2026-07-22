import { Elysia, status, t } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

export const userAdminPlugin = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin/users' })
  .use(userModel)
  .get('/', ({ query }) => UserService.list(query), {
    query: 'UserListQuery',
    response: { 200: 'UserListResponse' },
  })
  .get(
    '/:id',
    async ({ params }) => {
      const result = await UserService.getById(params.id)
      return result.match(
        (user) => user,
        (code) => status(404, { error: code, message: 'User not found' }),
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: 'UserResponse', 404: 'ErrorResponse' },
    },
  )
