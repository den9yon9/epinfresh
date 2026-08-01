import type { Db } from '@epinfresh/database'
import type { getEmailQueue } from '@epinfresh/queue'
import type { Redis } from '@epinfresh/redis'
import {
  authRateLimit,
  clearSessionCookie,
  createSessionPlugin,
  setSessionCookie,
} from '@epinfresh/session'
import { ErrorResponse, type Logger, commonModel } from '@epinfresh/shared'
import {
  LoginInputSchema,
  RegisterInputSchema,
  UserResponseSchema,
  getUserById,
  loginUser,
  registerUser,
} from '@epinfresh/user'
import { Elysia, status } from 'elysia'

export interface UserRoutesDeps {
  db: Db
  redis: Redis
  emailQueue: ReturnType<typeof getEmailQueue>
  logger: Logger
  sessionSecret: string
  isProduction: boolean
  trustProxy: boolean
}

export function userRoutes(deps: UserRoutesDeps) {
  const { logger, sessionSecret, isProduction, trustProxy } = deps
  return new Elysia({ name: 'user-storefront', prefix: '/api/v1/auth' })
    .use(commonModel)
    .decorate('db', deps.db)
    .use(createSessionPlugin({ redis: deps.redis, sessionSecret, isProduction, logger }))
    .use(authRateLimit({ redis: deps.redis, prefix: 'rl:auth', trustProxy }))
    .post(
      '/register',
      async ({ body, db }) => {
        const user = await registerUser(body, db)
        await deps.emailQueue.add('send-welcome-email', {
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
          (code) => status(401, { error: code, message: 'Invalid email or password' }),
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
          (code) => status(404, { error: code, message: 'User not found' }),
        )
      },
      {
        isAuth: true,
        response: { 200: UserResponseSchema, 401: ErrorResponse, 404: ErrorResponse },
        detail: { tags: ['Auth'] },
      },
    )
}
