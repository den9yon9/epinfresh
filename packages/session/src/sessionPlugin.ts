import { USER_ROLE, type UserRole } from '@epinfresh/database'
import type { Redis } from '@epinfresh/redis'
import { type Logger } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { type Cookie, Elysia, status } from 'elysia'

const SessionSchema = Type.Object({
  userId: Type.String(),
  role: Type.Union(USER_ROLE.map((r) => Type.Literal(r))),
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

function resolveSecret(secret: string): string {
  if (!secret || secret.length < 32) {
    throw new Error('[session] SESSION_SECRET is required (min 32 chars). Pass it via options.')
  }
  return secret
}

export interface SessionPluginOptions {
  redis: Redis
  sessionSecret: string
  isProduction: boolean
  logger: Logger
}

export function createSessionPlugin(options: SessionPluginOptions) {
  const { redis, isProduction, logger } = options
  const secret = resolveSecret(options.sessionSecret)
  // ponytail: debt — Elysia 1.4.x 的 cookie sign 配置实际未生效：serializeCookie 不签名，
  // 解析也不校验签名（无签名/带签名串都按原值使用）。当前 session_id 是 128-bit 随机 UUID（bearer token），
  // 攻击者无法伪造 Redis 中不存在的会话，风险低；但 sign 配置是假的，升级 Elysia 或改用显式签名时需复核。
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
            setSessionCookie(cookie.session_id, sessionId, isProduction)
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

export function setSessionCookie(
  cookie: Cookie<unknown> | undefined,
  sessionId: string,
  secure: boolean,
): void {
  if (!cookie) return
  cookie.set({
    value: sessionId,
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(cookie: Cookie<unknown> | undefined, secure: boolean): void {
  if (!cookie) return
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
