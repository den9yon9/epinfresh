import type { DomainError } from '@epinfresh/shared'
import { toHttpStatus } from '@epinfresh/shared'
import { Elysia, t } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

function setError(set: { status?: number | string | undefined }, err: DomainError) {
  const { statusCode, body } = toHttpStatus(err)
  set.status = statusCode
  return body
}

export const userAdminPlugin = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin/users' })
  .use(userModel)
  .get(
    '/',
    async ({ query, set }) => {
      const r = await UserService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
      })
      if (r.isOk()) return r.value
      return setError(set, r.error as never)
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const r = await UserService.getById(params.id)
      if (r.isOk()) return r.value
      return setError(set, r.error as never)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
    },
  )
