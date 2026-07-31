import type { Redis } from '@epinfresh/redis'
import { USER_ROLE, type UserRole, getEnv, logger } from '@epinfresh/shared'
import { Value } from '@sinclair/typebox/value'
import { type Cookie, Elysia, status, t } from 'elysia'

const SessionSchema = t.Object({
  userId: t.String(),
  role: t.Union(USER_ROLE.map((r) => t.Literal(r))),
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

function resolveSecret(secret?: string): string {
  const resolved = secret ?? getEnv().SESSION_SECRET
  if (!resolved || resolved.length < 32) {
    throw new Error(
      '[session] SESSION_SECRET is required (min 32 chars). Pass it via options or getEnv().',
    )
  }
  return resolved
}

export interface SessionPluginOptions {
  redis: Redis
  sessionSecret?: string
}

export function createSessionPlugin(options: SessionPluginOptions) {
  const { redis } = options
  const secret = resolveSecret(options.sessionSecret)
  return new Elysia({
    name: 'session',
    cookie: {
      secrets: secret,
      sign: ['session_id'],
    },
  })
    .decorate('sessionStore', createSessionStore(redis))
    .derive({ as: 'scoped' }, async ({ cookie }) => {
      const sessionId = cookie.session_id?.value
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { session: null } satisfies { session: Session | null }
      }
      try {
        const raw = await redis.get(`session:${sessionId}`)
        const session = parseSession(raw)
        if (session) {
          const ttl = await redis.ttl(`session:${sessionId}`)
          if (ttl > 0 && ttl < SESSION_TTL_SECONDS / 2) {
            await redis.expire(`session:${sessionId}`, SESSION_TTL_SECONDS)
            setSessionCookie(cookie.session_id, sessionId)
          }
        }
        return { session } satisfies { session: Session | null }
      } catch (err) {
        logger.error({ err }, 'session redis lookup failed')
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

export function setSessionCookie(cookie: Cookie<unknown> | undefined, sessionId: string): void {
  if (!cookie) return
  const secure = getEnv().NODE_ENV === 'production'
  cookie.set({
    value: sessionId,
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(cookie: Cookie<unknown> | undefined): void {
  if (!cookie) return
  const secure = getEnv().NODE_ENV === 'production'
  cookie.set({
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
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
      if (!sessionId) return null
      return parseSession(await redis.get(`session:${sessionId}`))
    },
    async destroy(sessionId) {
      if (!sessionId) return
      await redis.del(`session:${sessionId}`)
    },
  }
}
