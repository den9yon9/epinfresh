import { parseEnv } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

const corsOrigin = Type.Transform(Type.String({ default: '*' }))
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

const trustProxy = Type.Transform(Type.String({ default: 'false' }))
  .Decode((raw: string) => raw.trim() === 'true')
  .Encode((v) => (v ? 'true' : 'false'))

export const adminEnvSchema = Type.Object({
  DATABASE_URL: Type.String({ format: 'uri' }),
  REDIS_URL: Type.String({ format: 'uri' }),
  SESSION_SECRET: Type.String({ minLength: 32 }),
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    {
      default: 'development',
    },
  ),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('debug'),
      Type.Literal('info'),
      Type.Literal('warn'),
      Type.Literal('error'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  CORS_ORIGIN: corsOrigin,
  TRUST_PROXY: trustProxy,
  ADMIN_PORT: Type.String({ pattern: '^\\d+$' }),
})

export const env = parseEnv(adminEnvSchema)

if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === true) {
  throw new Error(
    '[ENV] CORS_ORIGIN cannot be "*" in production; set an explicit origin or comma-separated allowlist',
  )
}
