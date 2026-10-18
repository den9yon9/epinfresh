import { resolveRequestLocale } from '@epinfresh/http'
import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { assertNever, ErrorResponse, getRequestId } from '@epinfresh/shared'
import {
  consumePasswordResetToken,
  getUserById,
  loginUser,
  registerUser,
  requestPasswordReset,
  updateProfile,
  updateUserLocale,
} from '@epinfresh/user'
import { EMAIL_JOB_NAMES } from '@epinfresh/user/jobs'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createUserRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin, authRateLimit, emailQueuePlugin, isProduction } = plugins
  const { authRateLimitPerMinute, defaultLocale } = plugins
  // 请求语言: X-Locale/?lang= → Accept-Language → 默认(env DEFAULT_LOCALE)
  const requestLocale = (request: Request) => resolveRequestLocale(request, defaultLocale)
  return new Elysia({ name: 'user-storefront', prefix: '/auth' })
    .use(plugins.localePlugin)
    .use(dbPlugin)
    .use(sessionPlugin)
    .use(authRateLimit)
    .use(emailQueuePlugin)
    .post(
      '/register',
      async ({ body, db, emailQueue, request }) => {
        // 语言偏好: 请求线索落库 + 随欢迎邮件任务传递(worker 无请求上下文)
        const locale = requestLocale(request)
        const user = await registerUser(body, db, { locale })
        await emailQueue.add(
          EMAIL_JOB_NAMES.WELCOME,
          {
            to: user.email,
            requestId: getRequestId(),
            locale,
            payload: { userId: user.id, name: user.name },
          },
          { jobId: `welcome-${user.id}` },
        )
        return user
      },
      {
        body: UserModel.RegisterInputSchema,
        response: { 200: UserModel.UserResponseSchema },
        rateLimit: { limit: authRateLimitPerMinute, window: '60s' },
        detail: {
          tags: ['Auth'],
          summary: '注册',
          description: `注册新用户，成功后异步发送欢迎邮件。\n\n- 邮箱重复时由校验层返回错误\n- 限流：60 秒内最多 ${authRateLimitPerMinute} 次尝试`,
        },
      },
    )
    .post(
      '/login',
      async ({ body, cookie, db, sessionStore, request, i18n }) => {
        const result = await loginUser(body, db)
        return result.match(
          async (user) => {
            const oldSid = cookie.session_id?.value
            if (typeof oldSid === 'string' && oldSid.length > 0) {
              await sessionStore.destroy(oldSid)
            }
            // 登录刷新语言偏好(邮件等异步通知据此渲染)
            const locale = requestLocale(request)
            if (locale !== user.locale) {
              await updateUserLocale(user.id, locale, db)
              user.locale = locale
            }
            const sessionId = await sessionStore.create({ userId: user.id, role: user.role })
            setSessionCookie(cookie.session_id, sessionId, isProduction)
            return user
          },
          (e) => {
            switch (e) {
              case 'LOGIN_FAILED':
                return status(401, { error: e, message: i18n('Invalid email or password') })
              case 'ACCOUNT_DISABLED':
                return status(403, { error: e, message: i18n('Account is disabled') })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        body: UserModel.LoginInputSchema,
        // 限流值来自 env(生产默认 20/分); e2e 经 webServer 行内 env 注入放宽值
        rateLimit: { limit: authRateLimitPerMinute, window: '60s' },
        response: { 200: UserModel.UserResponseSchema, 401: ErrorResponse, 403: ErrorResponse },
        detail: {
          tags: ['Auth'],
          summary: '登录',
          description: `邮箱密码登录，成功后设置签名 session cookie。\n\n- 凭据错误返回 401\n- 账号被禁用返回 403\n- 限流：60 秒内最多 ${authRateLimitPerMinute} 次尝试`,
        },
      },
    )
    .post(
      '/forgot-password',
      async ({ body, db, emailQueue, request }) => {
        const result = await requestPasswordReset(body.email, db)
        const token = result.isOk() ? result.value.token : assertNever(result.error)
        await emailQueue.add(
          EMAIL_JOB_NAMES.RESET_PASSWORD,
          {
            to: body.email,
            requestId: getRequestId(),
            locale: requestLocale(request),
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
      async ({ body, db, i18n }) => {
        const result = await consumePasswordResetToken(body.token, body.password, db)
        return result.match(
          () => status(204),
          (e) => {
            switch (e) {
              case 'RESET_TOKEN_INVALID':
                return status(400, { error: e, message: i18n('Invalid or already used token') })
              case 'RESET_TOKEN_EXPIRED':
                return status(400, { error: e, message: i18n('Token expired') })
              default:
                return assertNever(e)
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
      async ({ session, db, i18n }) => {
        const result = await getUserById(session.userId, db)
        return result.match(
          (user) => user,
          (e) => {
            switch (e) {
              case 'USER_NOT_FOUND':
                return status(404, { error: e, message: i18n('User not found') })
              default:
                return assertNever(e)
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
    .patch(
      '/me',
      async ({ body, session, db, i18n }) => {
        const result = await updateProfile(session.userId, body, db)
        return result.match(
          (user) => user,
          (e) => {
            switch (e) {
              case 'USER_NOT_FOUND':
                return status(404, { error: e, message: i18n('User not found') })
              default:
                return assertNever(e)
            }
          },
        )
      },
      {
        isAuth: true,
        body: UserModel.UpdateProfileInputSchema,
        response: { 200: UserModel.UserResponseSchema, 404: ErrorResponse },
        detail: {
          tags: ['Auth'],
          summary: '更新个人资料',
          description: '更新当前登录用户的姓名、手机号、头像。\n\n- 需要登录\n- 用户不存在返回 404',
        },
      },
    )
}
