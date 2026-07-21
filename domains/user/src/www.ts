import {
  type Session,
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
  .derive({ as: 'scoped' }, () => ({
    sessionStore: createSessionStore(getRedis()),
  }))
  .post('/register', ({ body }) => UserService.register(body), {
    body: 'RegisterInput',
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
        () => status(401, { error: 'LOGIN_FAILED', message: 'Invalid email or password' }),
      )
    },
    { body: 'LoginInput', detail: { tags: ['Auth'] } },
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
        () => status(404, { error: 'USER_NOT_FOUND', message: 'User not found' }),
      )
    },
    { detail: { tags: ['Auth'] } },
  )
