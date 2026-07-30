import { getEmailQueue } from '@epinfresh/queue'
import {
  authRateLimit,
  clearSessionCookie,
  sessionPlugin,
  setSessionCookie,
} from '@epinfresh/session'
import { commonModel } from '@epinfresh/shared'
import { getUserById, loginUser, registerUser, userModel } from '@epinfresh/user'
import { Elysia, status } from 'elysia'

export const userRoutes = new Elysia({ name: 'user-storefront', prefix: '/api/v1/auth' })
  .use(userModel)
  .use(commonModel)
  .use(sessionPlugin)
  .use(authRateLimit({ prefix: 'rl:auth' }))
  .post(
    '/register',
    async ({ body }) => {
      const user = await registerUser(body)
      await getEmailQueue().add('send-welcome-email', {
        type: 'welcome',
        to: user.email,
        payload: { userId: user.id, name: user.name },
      })
      return user
    },
    {
      body: 'RegisterInput',
      response: { 200: 'UserResponse' },
      detail: { tags: ['Auth'] },
    },
  )
  .post(
    '/login',
    async ({ body, cookie, sessionStore }) => {
      const result = await loginUser(body)
      return result.match(
        async (user) => {
          const oldSid = cookie.session_id?.value
          if (typeof oldSid === 'string' && oldSid.length > 0) {
            await sessionStore.destroy(oldSid)
          }
          const sessionId = await sessionStore.create({ userId: user.id, role: user.role })
          setSessionCookie(cookie.session_id, sessionId)
          return user
        },
        (code) => status(401, { error: code, message: 'Invalid email or password' }),
      )
    },
    {
      body: 'LoginInput',
      rateLimit: { limit: 10, window: '60s' },
      response: { 200: 'UserResponse', 401: 'ErrorResponse', 429: 'ErrorResponse' },
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
      clearSessionCookie(cookie.session_id)
      return status(204)
    },
    { detail: { tags: ['Auth'] } },
  )
  .get(
    '/me',
    async ({ session }) => {
      const result = await getUserById(session.userId)
      return result.match(
        (user) => user,
        (code) => status(404, { error: code, message: 'User not found' }),
      )
    },
    {
      isAuth: true,
      response: { 200: 'UserResponse', 401: 'ErrorResponse', 404: 'ErrorResponse' },
      detail: { tags: ['Auth'] },
    },
  )
