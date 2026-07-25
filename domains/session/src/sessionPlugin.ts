import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { USER_ROLE, type UserRole } from '@epinfresh/shared'
import { Value } from '@sinclair/typebox/value'
import { type Cookie, Elysia, status, t } from 'elysia'
import { type Redis, getRedis } from './redis'

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

function signSessionId(sessionId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(sessionId).digest('base64url')
  return `${sessionId}.${sig}`
}

function unsignSessionToken(token: string, secret: string): string | null {
  const idx = token.lastIndexOf('.')
  if (idx <= 0 || idx >= token.length - 1) return null
  const id = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = createHmac('sha256', secret).update(id).digest('base64url')
  if (sig.length !== expected.length) return null
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null
  } catch {
    return null
  }
}

function resolveSecret(secret?: string): string {
  const resolved = secret ?? process.env.SESSION_SECRET
  if (!resolved || resolved.length < 32) {
    throw new Error(
      '[session] SESSION_SECRET is required (min 32 chars). Pass it via options or process.env.',
    )
  }
  return resolved
}

export interface SessionPluginOptions {
  redis?: Redis
  sessionSecret?: string
}

export function createSessionPlugin(options: SessionPluginOptions = {}) {
  const lazyRedis = (): Redis => options.redis ?? getRedis()
  const secret = resolveSecret(options.sessionSecret)
  return new Elysia({ name: 'session' })
    .derive({ as: 'scoped' }, () => ({
      sessionStore: createSessionStore(lazyRedis(), secret),
    }))
    .derive({ as: 'scoped' }, async (ctx) => {
      const cookieVal = ctx.cookie?.session_id?.value
      if (typeof cookieVal !== 'string' || cookieVal.length === 0) {
        return { session: null } satisfies { session: Session | null }
      }
      const sessionId = unsignSessionToken(cookieVal, secret)
      if (!sessionId) {
        return { session: null } satisfies { session: Session | null }
      }
      const redis = lazyRedis()
      try {
        const raw = await redis.get(`session:${sessionId}`)
        return { session: parseSession(raw) } satisfies { session: Session | null }
      } catch (err) {
        console.error('[session] redis lookup failed:', err)
        return { session: null } satisfies { session: Session | null }
      }
    })
    .macro({
      isAuth: {
        resolve({ session }) {
          if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
          return { session }
        },
      },
      isAdmin: {
        resolve({ session }) {
          if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
          if (session.role !== 'admin')
            return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
          return { session }
        },
      },
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
  read(token: string): Promise<Session | null>
  destroy(token: string): Promise<void>
}

export function createSessionStore(redis: Redis, secret: string): SessionStore {
  return {
    async create(session) {
      const sessionId = randomUUID()
      await redis.set(`session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
      return signSessionId(sessionId, secret)
    },
    async read(token) {
      const sessionId = unsignSessionToken(token, secret)
      if (!sessionId) return null
      return parseSession(await redis.get(`session:${sessionId}`))
    },
    async destroy(token) {
      const sessionId = unsignSessionToken(token, secret)
      if (!sessionId) return
      await redis.del(`session:${sessionId}`)
    },
  }
}
