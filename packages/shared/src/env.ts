import type { Static, TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

type Source = Record<string, string | undefined>

function collectErrors(schema: TObject, source: Source): string[] {
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

export function parseEnv<T extends TObject>(
  schema: T,
  source: Source = process.env as Source,
): Static<T> {
  const withDefaults = Value.Default(schema, source) as Source
  const missing = collectErrors(schema, withDefaults)
  if (missing.length > 0) throw new Error(`[ENV] missing or invalid: ${missing.join(', ')}`)
  return Value.Decode(schema, Value.Cast(schema, withDefaults)) as Static<T>
}
