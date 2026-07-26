import type { TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { type Static, t } from 'elysia'
export { t }

export const baseEnvSchema = t.Object({
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
  CORS_ORIGIN: t
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
    .Encode((v) => (typeof v === 'boolean' ? '*' : Array.isArray(v) ? v.join(',') : v)),
  TRUST_PROXY: t
    .Transform(t.String({ default: 'false' }))
    .Decode((raw: string) => raw.trim() === 'true')
    .Encode((v) => (v ? 'true' : 'false')),
})

type BaseEnv = Static<typeof baseEnvSchema>
type Schema = TObject
type Source = Record<string, string | undefined>

let cachedEnv: BaseEnv | null = null

function collectErrors(schema: Schema, source: Source): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const err of Value.Errors(schema, source)) {
    const key = err.path.slice(1) || '<root>'
    if (seen.has(key)) continue
    seen.add(key)
    out.push(`${key} (${err.message})`)
  }
  return out
}

export function loadEnv<T extends Schema>(schema: T, source: Source = process.env as Source) {
  const withDefaults = Value.Default(schema, source) as Source
  const missing = collectErrors(schema, withDefaults)
  if (missing.length > 0) throw new Error(`[ENV] missing or invalid: ${missing.join(', ')}`)
  const decoded = Value.Decode(schema, Value.Cast(schema, withDefaults))
  const env = decoded as { NODE_ENV?: string; CORS_ORIGIN?: unknown }
  if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === true) {
    throw new Error(
      '[ENV] CORS_ORIGIN cannot be "*" in production; set an explicit origin or comma-separated allowlist',
    )
  }
  cachedEnv = decoded as BaseEnv
  return decoded
}

export function getEnv(): BaseEnv {
  if (!cachedEnv) {
    cachedEnv = loadEnv(baseEnvSchema)
  }
  return cachedEnv
}
