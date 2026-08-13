import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { getUserById, listUsers, updateUser } from '@epinfresh/user'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status, t } from 'elysia'

import { type AdminPlugins } from '../plugins'

export function createUserRoutes(plugins: AdminPlugins) {
  return new Elysia({ name: 'user-admin', prefix: '/admin' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .get('/users', ({ query, db }) => listUsers(query, db), {
      isAdmin: true,
      query: UserModel.UserListQuerySchema,
      response: { 200: UserModel.UserListResponseSchema },
      detail: {
        tags: ['Admin/Users'],
        summary: '用户列表',
        description: '全部用户列表，支持分页与关键词筛选。\n\n- 需要 admin 角色',
      },
    })
    .get(
      '/users/:id',
      async ({ params, db }) => {
        const result = await getUserById(params.id, db)
        return result.match(
          (user) => user,
          (e) => {
            switch (e) {
              case 'USER_NOT_FOUND':
                return status(404, { error: e, message: 'User not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 200: UserModel.UserResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Admin/Users'],
          summary: '用户详情',
          description: '按 ID 获取用户信息。\n\n- 需要 admin 角色\n- 用户不存在返回 404',
        },
      },
    )
    .patch(
      '/users/:id',
      async ({ params, body, session, db, sessionStore }) => {
        // 禁止操作自己: 防降级/禁用自己导致后台失守
        if (params.id === session.userId) {
          return status(400, { error: 'SELF_OPERATION', message: 'Cannot modify your own account' })
        }
        const result = await updateUser(params.id, body, db)
        return result.match(
          async (user) => {
            // 降级/禁用即时踢掉该用户全部会话, 阻止旧会话继续使用旧权限
            if (body.role || body.isActive === false) {
              await sessionStore.destroyAllForUser(params.id)
            }
            return user
          },
          (e) => {
            switch (e) {
              case 'USER_NOT_FOUND':
                return status(404, { error: e, message: 'User not found' })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAdmin: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: UserModel.UpdateUserInputSchema,
        response: { 200: UserModel.UserResponseSchema, 400: ErrorResponse, 404: ErrorResponse },
        detail: {
          tags: ['Admin/Users'],
          summary: '更新用户',
          description:
            '修改用户角色或启用状态。\n\n- 需要 admin 角色\n- 禁止操作自己的账号\n- 降级或禁用时该用户所有会话立即失效\n- 用户不存在返回 404',
        },
      },
    )
}
