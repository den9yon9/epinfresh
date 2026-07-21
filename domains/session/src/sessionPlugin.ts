import { cookie } from '@elysiajs/cookie'
import { USER_ROLE, type UserRole } from '@epinfresh/shared'
import { Value } from '@sinclair/typebox/value'
import { type Cookie, Elysia, status, t } from 'elysia'
import { type Redis, closeRedis, createRedis, getRedis, initRedis } from './redis'

export { createRedis, initRedis, closeRedis, getRedis }
export type { Redis }

const SessionSchema = t.Object({
  userId: t.String(),
  role: t.Union([t.Literal(USER_ROLE[0]), t.Literal(USER_ROLE[1])]),
})

export type Session = { userId: string; role: UserRole }

export const SESSION_TTL_SECONDS = 86400

function parseSession(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!Value.Check(SessionSchema, value)) return null
    return value as Session
  } catch {
    return null
  }
}

export interface SessionPluginOptions {
  redis?: Redis
}

export function createSessionPlugin(options: SessionPluginOptions = {}) {
  const lazyRedis = (): Redis => options.redis ?? getRedis()
  return new Elysia({ name: 'session' }).use(cookie()).derive({ as: 'scoped' }, async (ctx) => {
    const cookieVal = ctx.cookie?.session_id?.value
    if (typeof cookieVal !== 'string' || cookieVal.length === 0) {
      return { session: null } satisfies { session: Session | null }
    }
    const redis = lazyRedis()
    try {
      const raw = await redis.get(`session:${cookieVal}`)
      return { session: parseSession(raw) } satisfies { session: Session | null }
    } catch (err) {
      console.error('[session] redis lookup failed:', err)
      return { session: null } satisfies { session: Session | null }
    }
  })
}

export interface CookieSetOptions {
  secure: boolean
}

export function setSessionCookie(
  cookie: Cookie<unknown> | undefined,
  sessionId: string,
  opts: CookieSetOptions,
): void {
  if (!cookie) return
  cookie.set({
    value: sessionId,
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(cookie: Cookie<unknown> | undefined): void {
  if (!cookie) return
  cookie.set({ value: '', httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
}

export interface SessionStore {
  create(session: Session): Promise<string>
  read(sessionId: string): Promise<Session | null>
  destroy(sessionId: string): Promise<void>
}

export function createSessionStore(redis: Redis): SessionStore {
  return {
    async create(session) {
      const sessionId = crypto.randomUUID()
      await redis.set(`session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
      return sessionId
    },
    async read(sessionId) {
      return parseSession(await redis.get(`session:${sessionId}`))
    },
    async destroy(sessionId) {
      await redis.del(`session:${sessionId}`)
    },
  }
}

function unauthorized() {
  return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
}

function forbidden() {
  return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
}

export function requireRole(role: UserRole) {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: derive session type propagated to guard context via cross-plugin
    beforeHandle: ({ session }: any) => {
      const s = session as Session | null
      if (!s) return unauthorized()
      if (s.role !== role) return forbidden()
    },
  }
}

export function requireAdmin() {
  return requireRole('admin')
}

export function requireSession() {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: derive session type propagated to guard context via cross-plugin
    beforeHandle: ({ session }: any) => {
      if (!(session as Session | null)) return unauthorized()
    },
  }
}
