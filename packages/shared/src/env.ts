import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'

export const baseEnvSchema = t.Object({
  DATABASE_URL: t.String({ format: 'uri' }),
  REDIS_URL: t.String({ format: 'uri' }),
  SESSION_SECRET: t.String({ minLength: 32 }),
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('production'), t.Literal('test')], {
    default: 'development',
  }),
})

export const wwwEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  WWW_PORT: t.String({ pattern: '^\\d+$' }),
})

export const adminEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  ADMIN_PORT: t.String({ pattern: '^\\d+$' }),
})

export type BaseEnv = {
  DATABASE_URL: string
  REDIS_URL: string
  SESSION_SECRET: string
  NODE_ENV: 'development' | 'production' | 'test'
}
export type WwwEnv = BaseEnv & { WWW_PORT: string }
export type AdminEnv = BaseEnv & { ADMIN_PORT: string }

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
  const missing = collectErrors(schema, source)
  if (missing.length > 0) throw new EnvValidationError(missing)

  return Value.Decode(schema, Value.Cast(schema, source)) as EnvOf<T>
}
