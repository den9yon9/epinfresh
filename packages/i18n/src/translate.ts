import zhCN from './catalog/zh-CN.json'
import { type Locale } from './locale'

// 目标语言 catalog: 英文源串 → 译文。en 不设 catalog(源即译文)。
// 以文案为 key(gettext 式): 同一段英文永远映射同一译文, 不同文案各自独立。
// catalog/*.json 由 scripts/i18n-extract.ts 扫描标记自动生成/校验, 勿手改 en。
type Catalog = Record<string, string>

const CATALOGS: Record<Locale, Catalog> = {
  en: {},
  'zh-CN': zhCN as Catalog,
}

export type TranslateParams = Record<string, string | number>

// 标记函数类型: i18n('英文源串', params?)。提取器按 i18n(...) 调用扫描。
export type Translator = (source: string, params?: TranslateParams) => string

// 翻译: 命中则返回译文, 未命中回落英文源串(源即默认语言, 漏译不崩)。
// params 以 {name} 占位符插值。
export function translate(locale: Locale, source: string, params?: TranslateParams): string {
  const template = CATALOGS[locale][source] ?? source
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

// 绑定语种, 产出标记函数 i18n。controller 经 derive 每请求注入; worker 按用户语言创建。
export function createTranslator(locale: Locale): Translator {
  return (source, params) => translate(locale, source, params)
}
