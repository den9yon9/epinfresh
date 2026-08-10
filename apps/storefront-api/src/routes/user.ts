import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { assertNever, ErrorResponse, getRequestId } from '@epinfresh/shared'
import {
  consumePasswordResetToken,
  getUserById,
  loginUser,
  registerUser,
  requestPasswordReset,
} from '@epinfresh/user'
import { EMAIL_JOB_NAMES } from '@epinfresh/user/jobs'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createUserRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin, authRateLimit, emailQueuePlugin, isProduction } = plugins
  return new Elysia({ name: 'user-storefront', prefix: '/auth' })
    .use(dbPlugin)
    .use(sessionPlugin)
    .use(authRateLimit)
    .use(emailQueuePlugin)
    .post(
      '/register',
      async ({ body, db, emailQueue }) => {
        const user = await registerUser(body, db)
        await emailQueue.add(
          EMAIL_JOB_NAMES.WELCOME,
          {
            to: user.email,
            requestId: getRequestId(),
            payload: { userId: user.id, name: user.name },
          },
          { jobId: `welcome-${user.id}` },
        )
        return user
      },
      {
        body: UserModel.RegisterInputSchema,
        response: { 200: UserModel.UserResponseSchema },
        rateLimit: { limit: 20, window: '60s' },
        detail: {
          tags: ['Auth'],
          summary: '注册',
          description: '注册新用户，成功后异步发送欢迎邮件。\n\n- 邮箱重复时由校验层返回错误',
        },
      },
    )
    .post(
      '/login',
      async ({ body, cookie, db, sessionStore }) => {
        const result = await loginUser(body, db)
        return result.match(
          async (user) => {
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
              case 'ACCOUNT_DISABLED':
                return status(403, { error: code, message: 'Account is disabled' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        body: UserModel.LoginInputSchema,
        // ponytail: 10/分 在 e2e 并行(mobile+desktop 共享 IP)下不足, 放宽到 20/分
        rateLimit: { limit: 20, window: '60s' },
        response: { 200: UserModel.UserResponseSchema, 401: ErrorResponse, 403: ErrorResponse },
        detail: {
          tags: ['Auth'],
          summary: '登录',
          description:
            '邮箱密码登录，成功后设置签名 session cookie。\n\n- 凭据错误返回 401\n- 账号被禁用返回 403\n- 限流：60 秒内最多 10 次尝试',
        },
      },
    )
    .post(
      '/forgot-password',
      async ({ body, db, emailQueue }) => {
        const result = await requestPasswordReset(body.email, db)
        const token = result.isOk() ? result.value.token : assertNever(result.error)
        await emailQueue.add(
          EMAIL_JOB_NAMES.RESET_PASSWORD,
          {
            to: body.email,
            requestId: getRequestId(),
            payload: { token },
          },
          { jobId: `reset-${crypto.randomUUID()}` },
        )
        return status(202)
      },
      {
        body: UserModel.ForgotPasswordInputSchema,
        rateLimit: { limit: 5, window: '60s' },
        detail: {
          tags: ['Auth'],
          summary: '忘记密码',
          description: '发送密码重置邮件。邮箱不存在也返回 202, 不泄露注册状态',
        },
      },
    )
    .post(
      '/reset-password',
      async ({ body, db }) => {
        const result = await consumePasswordResetToken(body.token, body.password, db)
        return result.match(
          () => status(204),
          (code) => {
            switch (code) {
              case 'RESET_TOKEN_INVALID':
                return status(400, { error: code, message: 'Invalid or already used token' })
              case 'RESET_TOKEN_EXPIRED':
                return status(400, { error: code, message: 'Token expired' })
              default:
                return assertNever(code)
            }
          },
        )
      },
      {
        body: UserModel.ResetPasswordInputSchema,
        rateLimit: { limit: 10, window: '60s' },
        detail: {
          tags: ['Auth'],
          summary: '重置密码',
          description: '用邮件中的令牌设置新密码。令牌一次性使用, 1 小时过期',
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
          summary: '当前用户信息',
          description: '获取当前登录用户的信息。\n\n- 需要登录\n- 用户不存在返回 404',
        },
      },
    )
}
