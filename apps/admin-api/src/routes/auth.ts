import { commonModel } from '@epinfresh/http'
import { clearSessionCookie, setSessionCookie } from '@epinfresh/session'
import { ErrorResponse } from '@epinfresh/shared'
import { getUserById, loginUser } from '@epinfresh/user'
import * as UserModel from '@epinfresh/user/model'
import { Elysia, status } from 'elysia'

import { adminDb, adminSession, isProduction } from '../plugins'

export const authRoutes = new Elysia({ name: 'auth-admin', prefix: '/api/v1/auth' })
  .use(commonModel)
  .use(adminDb)
  .use(adminSession)
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
          }
        },
      )
    },
    {
      body: UserModel.LoginInputSchema,
      rateLimit: { limit: 10, window: '60s' },
      response: {
        200: UserModel.UserResponseSchema,
        401: ErrorResponse,
        403: ErrorResponse,
        429: ErrorResponse,
      },
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
