import { commonModel } from '@epinfresh/http'
import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { ErrorResponse } from '@epinfresh/shared'
import { getUserById, loginUser, registerUser } from '@epinfresh/user'
import { EMAIL_JOB_NAMES } from '@epinfresh/user/jobs'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

export function createUserRoutes(plugins: StorefrontPlugins) {
  const { dbPlugin, sessionPlugin, authRateLimit, emailQueuePlugin, isProduction } = plugins
  return new Elysia({ name: 'user-storefront', prefix: '/api/v1/auth' })
    .use(commonModel)
    .use(dbPlugin)
    .use(sessionPlugin)
    .use(authRateLimit)
    .use(emailQueuePlugin)
    .post(
      '/register',
      async ({ body, db, emailQueue }) => {
        const user = await registerUser(body, db)
        // ponytail: debt — job 不带 requestId, 无法回溯到请求; 接真邮件/支付回执时在 payload 里带上 requestId
        await emailQueue.add(
          EMAIL_JOB_NAMES.WELCOME,
          {
            to: user.email,
            payload: { userId: user.id, name: user.name },
          },
          { jobId: `welcome-${user.id}` },
        )
        return user
      },
      {
        body: UserModel.RegisterInputSchema,
        response: { 200: UserModel.UserResponseSchema },
        detail: { tags: ['Auth'] },
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
            }
          },
        )
      },
      {
        body: UserModel.LoginInputSchema,
        rateLimit: { limit: 10, window: '60s' },
        response: { 200: UserModel.UserResponseSchema, 401: ErrorResponse, 429: ErrorResponse },
        detail: { tags: ['Auth'] },
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
      { detail: { tags: ['Auth'] } },
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
            }
          },
        )
      },
      {
        isAuth: true,
        response: { 200: UserModel.UserResponseSchema, 401: ErrorResponse, 404: ErrorResponse },
        detail: { tags: ['Auth'] },
      },
    )
}
