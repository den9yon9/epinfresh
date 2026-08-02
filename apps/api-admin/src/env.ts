import { parseEnv } from '@epinfresh/shared'
import { t } from 'elysia'

const corsOrigin = t
  .Transform(t.String({ default: '*' }))
  .Decode((raw: string) => {
    const s = raw.trim()
    if (s === '*') return true
    const list = s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    if (list.length === 0) return true
    if (list.length === 1) return list[0] as string
    return list
  })
  .Encode((v) => (typeof v === 'boolean' ? '*' : Array.isArray(v) ? v.join(',') : v))

const trustProxy = t
  .Transform(t.String({ default: 'false' }))
  .Decode((raw: string) => raw.trim() === 'true')
  .Encode((v) => (v ? 'true' : 'false'))

export const adminEnvSchema = t.Object({
  DATABASE_URL: t.String({ format: 'uri' }),
  REDIS_URL: t.String({ format: 'uri' }),
  SESSION_SECRET: t.String({ minLength: 32 }),
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('production'), t.Literal('test')], {
    default: 'development',
  }),
  LOG_LEVEL: t.Union(
    [
      t.Literal('debug'),
      t.Literal('info'),
      t.Literal('warn'),
      t.Literal('error'),
      t.Literal('silent'),
    ],
    { default: 'info' },
  ),
  CORS_ORIGIN: corsOrigin,
  TRUST_PROXY: trustProxy,
  ADMIN_PORT: t.String({ pattern: '^\\d+$' }),
})

export const env = parseEnv(adminEnvSchema)

if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === true) {
  throw new Error(
    '[ENV] CORS_ORIGIN cannot be "*" in production; set an explicit origin or comma-separated allowlist',
  )
}
