import {
  type Session,
  authRateLimit,
  clearSessionCookie,
  createSessionPlugin,
  createSessionStore,
  getRedis,
  setSessionCookie,
} from '@epinfresh/session'
import { Elysia, status } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

export const userWWWPlugin = new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
  .use(userModel)
  .use(createSessionPlugin())
  .use(authRateLimit({ prefix: 'rl:auth' }))
  .derive({ as: 'scoped' }, () => ({
    sessionStore: createSessionStore(getRedis()),
  }))
  .post('/register', ({ body }) => UserService.register(body), {
    body: 'RegisterInput',
    response: { 200: 'UserResponse' },
    detail: { tags: ['Auth'] },
  })
  .post(
    '/login',
    async ({ body, cookie, sessionStore }) => {
      const result = await UserService.login(body)
      return result.match(
        async (user) => {
          const sessionId = await sessionStore.create({ userId: user.id, role: user.role })
          setSessionCookie(cookie.session_id, sessionId, {
            secure: process.env.NODE_ENV === 'production',
          })
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
    async ({ session: s }) => {
      const session = s as Session | null
      if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
      const result = await UserService.getById(session.userId)
      return result.match(
        (user) => user,
        (code) => status(404, { error: code, message: 'User not found' }),
      )
    },
    {
      response: { 200: 'UserResponse', 401: 'ErrorResponse', 404: 'ErrorResponse' },
      detail: { tags: ['Auth'] },
    },
  )
