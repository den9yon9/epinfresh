import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { ErrorResponse, commonModel, toError } from '@epinfresh/shared'
import {
  LoginInputSchema,
  RegisterInputSchema,
  USER_ERRORS,
  UserResponseSchema,
  getUserById,
  loginUser,
  registerUser,
} from '@epinfresh/user'
import { Elysia, status } from 'elysia'
import {
  isProduction,
  storeAuthRateLimit,
  storeDb,
  storeEmailQueue,
  storeSession,
} from '../plugins'

export const userRoutes = new Elysia({ name: 'user-storefront', prefix: '/api/v1/auth' })
  .use(commonModel)
  .use(storeDb)
  .use(storeSession)
  .use(storeAuthRateLimit)
  .use(storeEmailQueue)
  .post(
    '/register',
    async ({ body, db, emailQueue }) => {
      const user = await registerUser(body, db)
      // ponytail: debt — job 不带 requestId, 无法回溯到请求; 接真邮件/支付回执时在 payload 里带上 requestId
      await emailQueue.add('send-welcome-email', {
        type: 'welcome',
        to: user.email,
        payload: { userId: user.id, name: user.name },
      })
      return user
    },
    {
      body: RegisterInputSchema,
      response: { 200: UserResponseSchema },
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
        (code) => toError(USER_ERRORS, code),
      )
    },
    {
      body: LoginInputSchema,
      rateLimit: { limit: 10, window: '60s' },
      response: { 200: UserResponseSchema, 401: ErrorResponse, 429: ErrorResponse },
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
        (code) => toError(USER_ERRORS, code),
      )
    },
    {
      isAuth: true,
      response: { 200: UserResponseSchema, 401: ErrorResponse, 404: ErrorResponse },
      detail: { tags: ['Auth'] },
    },
  )
