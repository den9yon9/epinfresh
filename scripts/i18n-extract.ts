import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'

// 文案提取器: 扫描用户可见面里的 i18n 标记, 生成/校验 catalog。
//
//   i18n('英文源串')          ← 标记(函数式), controller 经 derive 注入 / worker 按用户语言创建
//   translate(locale, '英文源串')  ← 基础设施边界(session/限流)的显式形式
//
// 用法:
//   bun scripts/i18n-extract.ts           生成/更新 packages/i18n/src/catalog/{en,zh-CN}.json
//   bun scripts/i18n-extract.ts --check   只校验(--check 供 CI / pre-commit): 漏译/陈旧则退出码 1

const ROOT = join(import.meta.dir, '..')
const CATALOG_DIR = join(ROOT, 'packages/i18n/src/catalog')
const SOURCE_LOCALE = 'en'
// 需要翻译的目标语言(源语言 en 之外); 新增语言时在此登记 + 加 catalog 文件
const TARGET_LOCALES = ['zh-CN'] as const

// 用户可见面: 只扫这些目录的源码
const SCAN_ROOTS = [
  'apps/storefront-api/src',
  'apps/admin-api/src',
  'apps/worker/src',
  'packages/session/src',
]

const IGNORED_FILE_RE = /\.(test|spec)\.tsx?$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry) && !IGNORED_FILE_RE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

// 仅接受字符串字面量(含无插值模板串); 提取依赖字面量, 动态拼接由 eslint marker-literal 拦截
function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function collectMarkers(file: string, text: string, into: Set<string>, dynamic: string[]): void {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      if (name === 'i18n') {
        const value = literalText(node.arguments[0])
        if (value === null) dynamic.push(`${relative(ROOT, file)}: i18n(...) 首参不是字面量`)
        else into.add(value)
      } else if (name === 'translate') {
        const value = literalText(node.arguments[1])
        if (value === null)
          dynamic.push(`${relative(ROOT, file)}: translate(locale, ...) 第二参不是字面量`)
        else into.add(value)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function readCatalog(locale: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(CATALOG_DIR, `${locale}.json`), 'utf8')) as Record<
      string,
      string
    >
  } catch {
    return {}
  }
}

function writeCatalog(locale: string, data: Record<string, string>): void {
  writeFileSync(join(CATALOG_DIR, `${locale}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function main(): void {
  const check = process.argv.includes('--check')

  const sources = new Set<string>()
  const dynamic: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      collectMarkers(file, readFileSync(file, 'utf8'), sources, dynamic)
    }
  }
  const sorted = [...sources].sort()

  const enExisting = readCatalog(SOURCE_LOCALE)
  const en: Record<string, string> = {}
  for (const key of sorted) en[key] = key

  const targetExisting: Record<string, Record<string, string>> = {}
  for (const locale of TARGET_LOCALES) targetExisting[locale] = readCatalog(locale)

  const problems: string[] = []

  if (dynamic.length > 0) problems.push(...dynamic)

  const enRemoved = Object.keys(enExisting).filter((k) => !sources.has(k))
  if (enRemoved.length > 0) problems.push(`en.json 存在已无标记的陈旧 key: ${enRemoved.join(', ')}`)

  const merged: Record<string, Record<string, string>> = {}
  for (const locale of TARGET_LOCALES) {
    const existing = targetExisting[locale]
    const next: Record<string, string> = {}
    const untranslated: string[] = []
    for (const key of sorted) {
      const value = existing[key] ?? ''
      next[key] = value
      if (typeof value !== 'string' || value.length === 0) untranslated.push(key)
    }
    // 保留陈旧键的译文(不静默丢翻译); 陈旧仅由 --check 报告, 人工清理
    for (const key of Object.keys(existing)) {
      if (!(key in next)) next[key] = existing[key]
    }
    const stale = Object.keys(existing).filter((k) => !sources.has(k))
    merged[locale] = next
    if (untranslated.length > 0) {
      problems.push(
        `${locale}.json 有 ${untranslated.length} 条未翻译:\n  - ${untranslated.join('\n  - ')}`,
      )
    }
    if (stale.length > 0) {
      problems.push(`${locale}.json 存在陈旧 key(源码已无此标记): ${stale.join(', ')}`)
    }
  }

  if (check) {
    if (problems.length > 0) {
      console.error('[i18n:check] 失败:\n' + problems.join('\n'))
      process.exit(1)
    }
    console.log(`[i18n:check] 通过: ${sorted.length} 条标记全部有译文`)
    return
  }

  writeCatalog(SOURCE_LOCALE, en)
  for (const locale of TARGET_LOCALES) writeCatalog(locale, merged[locale])
  console.log(
    `[i18n:extract] 扫描到 ${sorted.length} 条标记; 已写入 en.json + ${TARGET_LOCALES.join(', ')}`,
  )
  if (problems.length > 0) {
    console.warn('[i18n:extract] 待处理:\n' + problems.join('\n'))
  }
}

main()
