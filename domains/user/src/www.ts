import { cookie } from '@elysiajs/cookie'
import { Elysia, t } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'
import { redis } from './session'

export const userWWWPlugin = new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
  .use(userModel)
  .use(cookie())
  .derive(async (ctx) => {
    const sessionId = ctx.cookie.session_id?.value
    if (sessionId) {
      try {
        const raw = await redis.get(`session:${sessionId}`)
        if (raw) return { session: JSON.parse(raw) as { userId: string; role: string } }
      } catch {}
    }
    return { session: null as { userId: string; role: string } | null }
  })
  .post(
    '/register',
    async ({ body }) => {
      return UserService.register(body)
    },
    {
      body: 'RegisterInput',
      response: { 200: 'UserResponse', 409: t.String() },
      detail: { tags: ['Auth'] },
    },
  )
  .post(
    '/login',
    async ({ body, cookie, status }) => {
      const user = await UserService.login(body)
      if (!user) return status(401, 'Invalid email or password')

      const sessionId = crypto.randomUUID()
      await redis.set(
        `session:${sessionId}`,
        JSON.stringify({ userId: user.id, role: user.role }),
        'EX',
        86400,
      )
      cookie.session_id.set({ value: sessionId, httpOnly: true, path: '/' })
      return user
    },
    {
      body: 'LoginInput',
      response: { 200: 'UserResponse', 401: t.String() },
      detail: { tags: ['Auth'] },
    },
  )
  .post('/logout', async ({ cookie, status }) => {
    const sid = cookie.session_id?.value
    if (sid) {
      await redis.del(`session:${sid}`)
      cookie.session_id.set({ value: '', httpOnly: true, path: '/', maxAge: 0 })
    }
    return status(204)
  })
  .get('/me', async ({ session }) => {
    if (!session) return null
    return UserService.getById(session.userId)
  })
