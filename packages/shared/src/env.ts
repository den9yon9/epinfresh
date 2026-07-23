import { Value } from '@sinclair/typebox/value'
import { type Static, t } from 'elysia'

export type CorsOrigin = boolean | string | string[]

function parseCorsOrigin(raw: string): CorsOrigin {
  const s = raw.trim()
  if (s === '*') return true
  const list = s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
  if (list.length === 0) return true
  if (list.length === 1) return list[0] as string
  return list
}

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
    .Decode((v: string) => parseCorsOrigin(v))
    .Encode((v: CorsOrigin) => (typeof v === 'boolean' ? '*' : Array.isArray(v) ? v.join(',') : v)),
})

export const wwwEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  WWW_PORT: t.String({ pattern: '^\\d+$' }),
})

export const adminEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  ADMIN_PORT: t.String({ pattern: '^\\d+$' }),
})

export type BaseEnv = Static<typeof baseEnvSchema>
export type WwwEnv = Static<typeof wwwEnvSchema>
export type AdminEnv = Static<typeof adminEnvSchema>

export class EnvValidationError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(`[ENV] missing or invalid: ${missing.join(', ')}`)
    this.name = 'EnvValidationError'
    this.missing = missing
  }
}

type Schema = typeof baseEnvSchema | typeof wwwEnvSchema | typeof adminEnvSchema
type Source = Record<string, string | undefined>
type EnvOf<T extends Schema> = T extends typeof wwwEnvSchema
  ? WwwEnv
  : T extends typeof adminEnvSchema
    ? AdminEnv
    : BaseEnv

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

export function loadEnv<T extends Schema>(
  schema: T,
  source: Source = process.env as Source,
): EnvOf<T> {
  const withDefaults = Value.Default(schema, source) as Source
  const missing = collectErrors(schema, withDefaults)
  if (missing.length > 0) throw new EnvValidationError(missing)

  return Value.Decode(schema, Value.Cast(schema, withDefaults)) as EnvOf<T>
}
