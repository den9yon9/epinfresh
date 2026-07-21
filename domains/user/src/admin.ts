import { Elysia, status, t } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

export const userAdminPlugin = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin/users' })
  .use(userModel)
  .get(
    '/',
    ({ query }) =>
      UserService.list({ page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 }),
    { query: t.Object({ page: t.Optional(t.String()), pageSize: t.Optional(t.String()) }) },
  )
  .get(
    '/:id',
    async ({ params }) => {
      const result = await UserService.getById(params.id)
      return result.match(
        (user) => user,
        () => status(404, { error: 'USER_NOT_FOUND', message: 'User not found' }),
      )
    },
    { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
