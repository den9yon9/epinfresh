// 语言协商(纯逻辑, 零依赖): 显式覆盖(X-Locale/?lang) → Accept-Language(q 值排序) → 默认回退。
// 默认回退 en: 英文即"源语言", 漏译时天然回落英文, 不引入额外失败面。

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

// 将任意 BCP-47 语言标签归一化到受支持语言: en-*/en → en; zh-*/zh → zh-CN。
export function normalizeLocale(tag: string): Locale | null {
  const base = tag.trim().toLowerCase()
  if (base === 'en' || base.startsWith('en-')) return 'en'
  if (base === 'zh' || base.startsWith('zh-')) return 'zh-CN'
  return null
}

// 解析 Accept-Language: 按 q 值降序返回语言标签(去空、q=0 视为不可接受)。
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(';')
      let q = 1
      for (const param of params) {
        const match = /^\s*q=([0-9.]+)\s*$/.exec(param)
        if (match) {
          const parsed = Number.parseFloat(match[1])
          if (!Number.isNaN(parsed)) q = parsed
        }
      }
      return { tag: (rawTag ?? '').trim(), q }
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag)
}

export interface ResolveLocaleInput {
  // 显式覆盖(X-Locale 头 / ?lang= 查询)
  override?: string | null
  acceptLanguage?: string | null
  fallback?: Locale
}

export function resolveLocale(input: ResolveLocaleInput = {}): Locale {
  const fallback = input.fallback ?? DEFAULT_LOCALE

  const override = input.override?.trim()
  if (override) {
    const normalized = isLocale(override) ? override : normalizeLocale(override)
    if (normalized) return normalized
  }

  if (input.acceptLanguage) {
    for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
      const normalized = normalizeLocale(tag)
      if (normalized) return normalized
    }
  }

  return fallback
}
