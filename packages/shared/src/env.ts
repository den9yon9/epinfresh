import { FormatRegistry, type StaticDecode, type TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

// ponytail: elysia 进程里会自注册 format; 非 elysia 消费者 (worker) 需要这里补注册
if (!FormatRegistry.Has('uri'))
  FormatRegistry.Set('uri', (v) => {
    try {
      return typeof v === 'string' && new URL(v).protocol.length > 0
    } catch {
      return false
    }
  })
if (!FormatRegistry.Has('uuid'))
  FormatRegistry.Set(
    'uuid',
    (v) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v),
  )
if (!FormatRegistry.Has('email'))
  FormatRegistry.Set('email', (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))

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
): StaticDecode<T> {
  const withDefaults = Value.Default(schema, source) as Source
  const missing = collectErrors(schema, withDefaults)
  if (missing.length > 0) throw new Error(`[ENV] missing or invalid: ${missing.join(', ')}`)
  return Value.Decode(schema, Value.Cast(schema, withDefaults)) as StaticDecode<T>
}
