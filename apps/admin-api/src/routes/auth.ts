import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { assertNever, ErrorResponse } from '@epinfresh/shared'
import { getUserById, loginUser } from '@epinfresh/user'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status } from 'elysia'

import { type AdminPlugins } from '../plugins'

export function createAuthRoutes(plugins: AdminPlugins) {
  const { dbPlugin, sessionPlugin, isProduction } = plugins
  return new Elysia({ name: 'auth-admin', prefix: '/auth' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .post(
      '/login',
      async ({ body, cookie, db, sessionStore }) => {
        const result = await loginUser(body, db)
        return result.match(
          async (user) => {
            if (user.role !== 'admin') {
              return status(403, { error: 'FORBIDDEN', message: 'Account is not an administrator' })
            }
            const oldSid = cookie.session_id?.value
            if (typeof oldSid === 'string' && oldSid.length > 0) {
              await sessionStore.destroy(oldSid)
            }
            const sessionId = await sessionStore.create({ userId: user.id, role: user.role })
            setSessionCookie(cookie.session_id, sessionId, isProduction)
            return user
          },
          (code) => {
            switch (code) {
              case 'LOGIN_FAILED':
                return status(401, { error: code, message: 'Invalid email or password' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        body: UserModel.LoginInputSchema,
        // ponytail: 10/分 在 e2e 并行与调试节奏下不足, 放宽到 20/分
        rateLimit: { limit: 20, window: '60s' },
        response: {
          200: UserModel.UserResponseSchema,
          401: ErrorResponse,
          403: ErrorResponse,
        },
        detail: {
          tags: ['Auth'],
          summary: '管理员登录',
          description:
            '管理员登录，成功后设置签名 session cookie。\n\n- 凭据错误返回 401\n- 仅 admin 角色可登录，否则返回 403\n- 限流：60 秒内最多 10 次尝试',
        },
      },
    )
    .post(
      '/logout',
      async ({ cookie, session, sessionStore }) => {
        if (session) {
          const sid = cookie.session_id?.value
          if (typeof sid === 'string' && sid.length > 0) await sessionStore.destroy(sid)
        }
        clearSessionCookie(cookie.session_id, isProduction)
        return status(204)
      },
      {
        detail: {
          tags: ['Auth'],
          summary: '退出登录',
          description: '销毁当前 session 并清除 cookie。\n\n- 成功返回 204 无返回体',
        },
      },
    )
    .get(
      '/me',
      async ({ session, db }) => {
        const result = await getUserById(session.userId, db)
        return result.match(
          (user) => user,
          (code) => {
            switch (code) {
              case 'USER_NOT_FOUND':
                return status(404, { error: code, message: 'User not found' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        isAuth: true,
        response: { 200: UserModel.UserResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Auth'],
          summary: '当前管理员信息',
          description: '获取当前登录管理员的信息。\n\n- 需要登录\n- 用户不存在返回 404',
        },
      },
    )
}
