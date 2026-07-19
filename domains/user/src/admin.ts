import { cookie } from '@elysiajs/cookie'
import { Elysia, status } from 'elysia'
import { userModel } from './model'
import { UserService } from './service'
import { redis } from './session'

export const userAdminPlugin = new Elysia({ name: 'user-admin', prefix: '/api/v1/admin/users' })
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
  .guard({
    // biome-ignore lint/suspicious/noExplicitAny: session type from derive not inferred in guard
    beforeHandle: (ctx: any) => {
      if (!ctx.session || ctx.session.role !== 'admin') {
        return status(403, 'Forbidden')
      }
    },
  })
  .get('/', async () => UserService.list())
  .get('/:id', async ({ params: { id } }) => {
    return UserService.getById(id)
  })
