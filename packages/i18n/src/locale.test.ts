import { describe, expect, test } from 'bun:test'

import { DEFAULT_LOCALE, normalizeLocale, resolveLocale } from './locale'

describe('normalizeLocale', () => {
  test('maps en-family to en and zh-family to zh-CN', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN')
    expect(normalizeLocale('ZH-cn')).toBe('zh-CN')
  })

  test('returns null for unsupported locales', () => {
    expect(normalizeLocale('fr')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
  })
})

describe('resolveLocale', () => {
  test('returns the fallback when no hints are present', () => {
    expect(resolveLocale()).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ fallback: 'zh-CN' })).toBe('zh-CN')
  })

  test('explicit override wins over Accept-Language', () => {
    expect(resolveLocale({ override: 'zh-CN', acceptLanguage: 'en-US,en;q=0.9' })).toBe('zh-CN')
  })

  test('picks the highest-q supported language from Accept-Language', () => {
    expect(resolveLocale({ acceptLanguage: 'fr;q=1.0, zh-CN;q=0.8, en;q=0.5' })).toBe('zh-CN')
    expect(resolveLocale({ acceptLanguage: 'fr, de' })).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ acceptLanguage: 'fr, de', fallback: 'zh-CN' })).toBe('zh-CN')
  })

  test('ignores languages with q=0', () => {
    expect(resolveLocale({ acceptLanguage: 'zh-CN;q=0, en' })).toBe('en')
  })
})
