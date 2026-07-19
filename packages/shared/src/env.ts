import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'

const envSchema = t.Object({
  DATABASE_URL: t.String(),
  REDIS_URL: t.String(),
  SESSION_SECRET: t.String(),
  WWW_PORT: t.String(),
  ADMIN_PORT: t.String(),
})

function load() {
  const errors = [...Value.Errors(envSchema, process.env)]
  if (errors.length > 0) {
    const seen = new Set<string>()
    for (const err of errors) {
      const key = err.path.slice(1)
      if (seen.has(key)) continue
      seen.add(key)
      console.error(`[ENV] ${key} — ${err.message}`)
    }
    process.exit(1)
  }

  const parsed = Value.Decode(envSchema, process.env)

  return {
    DATABASE_URL: parsed.DATABASE_URL,
    REDIS_URL: parsed.REDIS_URL,
    SESSION_SECRET: parsed.SESSION_SECRET,
    WWW_PORT: parsed.WWW_PORT,
    ADMIN_PORT: parsed.ADMIN_PORT,
  }
}

export const env = load()
