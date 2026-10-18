import { createTranslator, type Locale, resolveLocale } from '@epinfresh/i18n'
import { Elysia } from 'elysia'

export interface LocalePluginOptions {
  // 无请求语言线索时的回退语言(来自 env DEFAULT_LOCALE)
  defaultLocale: Locale
}

// 从请求解析语言线索: X-Locale 头 / ?lang= 查询覆盖 → Accept-Language → fallback。
export function resolveRequestLocale(request: Request, fallback: Locale): Locale {
  let searchLang: string | null
  try {
    searchLang = new URL(request.url).searchParams.get('lang')
  } catch {
    searchLang = null
  }
  return resolveLocale({
    override: request.headers.get('x-locale') ?? searchLang,
    acceptLanguage: request.headers.get('accept-language'),
    fallback,
  })
}

// i18n 属呈现层关注点: derive 每请求注入绑定语言标记函数 i18n。
// controller 用它包裹用户可见文案(如 status(404, { message: i18n('Order not found') }));
// domain/usecase 一律不产出文案(见 eslint i18n/no-core-import)。
export function localePlugin(options: LocalePluginOptions) {
  return new Elysia({ name: 'i18n-locale' }).derive({ as: 'global' }, ({ request }) => ({
    i18n: createTranslator(resolveRequestLocale(request, options.defaultLocale)),
  }))
}
