import type { Db } from '@epinfresh/database'
import type { Redis } from '@epinfresh/redis'
import { createSessionPlugin } from '@epinfresh/session'
import { ErrorResponse, type Logger, commonModel } from '@epinfresh/shared'
import {
  UserListQuerySchema,
  UserListResponseSchema,
  UserResponseSchema,
  getUserById,
  listUsers,
} from '@epinfresh/user'
import { Elysia, status, t } from 'elysia'

const adminResponse = { 401: ErrorResponse, 403: ErrorResponse } as const

export function userRoutes(deps: {
  db: Db
  redis: Redis
  logger: Logger
  sessionSecret: string
  isProduction: boolean
}) {
  const { logger, sessionSecret, isProduction } = deps
  return new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
    .use(commonModel)
    .decorate('db', deps.db)
    .use(createSessionPlugin({ redis: deps.redis, sessionSecret, isProduction, logger }))
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
          (code) => status(404, { error: code, message: 'User not found' }),
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: UserResponseSchema, 404: ErrorResponse, ...adminResponse },
        detail: { tags: ['Admin/Users'] },
      },
    )
}
