import {
  type Session,
  clearSessionCookie,
  createSessionPlugin,
  createSessionStore,
  getRedis,
  setSessionCookie,
} from '@epinfresh/session'
import { isProduction, toHttpStatus } from '@epinfresh/shared'
import type { DomainError } from '@epinfresh/shared'
import { Elysia } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'

function setError(set: { status?: number | string | undefined }, err: DomainError) {
  const { statusCode, body } = toHttpStatus(err)
  set.status = statusCode
  return body
}

export const userWWWPlugin = new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
  .use(userModel)
  .use(createSessionPlugin())
  .derive({ as: 'scoped' }, () => ({
    sessionStore: createSessionStore(getRedis()),
  }))
  .post(
    '/register',
    async ({ body, set }) => {
      const r = await UserService.register(body)
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      body: 'RegisterInput',
      detail: { tags: ['Auth'] },
    },
  )
  .post(
    '/login',
    async ({ body, cookie, sessionStore, set }) => {
      const r = await UserService.login(body)
      if (r.isErr()) return setError(set, r.error as never)
      const user = r.value
      const sessionId = await sessionStore.create({ userId: user.id, role: user.role })
      setSessionCookie(cookie.session_id, sessionId, { secure: isProduction() })
      return user
    },
    {
      body: 'LoginInput',
      detail: { tags: ['Auth'] },
    },
  )
  .post(
    '/logout',
    async ({ cookie, session, sessionStore, set }) => {
      if (session) {
        const sid = cookie.session_id?.value
        if (typeof sid === 'string' && sid.length > 0) await sessionStore.destroy(sid)
      }
      clearSessionCookie(cookie.session_id)
      set.status = 204
      return null
    },
    {
      detail: { tags: ['Auth'] },
    },
  )
  .get(
    '/me',
    async ({ session, set }) => {
      const s = session as Session | null
      if (!s) {
        set.status = 401
        return { error: 'UNAUTHORIZED', message: 'Unauthorized' }
      }
      const r = await UserService.getById(s.userId)
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      detail: { tags: ['Auth'] },
    },
  )
