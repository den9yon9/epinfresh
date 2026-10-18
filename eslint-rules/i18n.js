// ESLint 本地插件: i18n 标记纪律
//
// 模型: 用户可见文案必须用标记函数包裹(i18n('英文源串') / 基础设施边界 translate(locale, '源串')),
// 提取器(scripts/i18n-extract.ts)扫描这些标记生成/校验 catalog。
//   - marker-literal: 标记实参必须是字符串字面量, 否则静态扫描不到
//   - no-cjk-literal: 用户可见面禁止裸中文字面量(OpenAPI detail 除外, 那是开发者文档不翻译)
//   - no-core-import: domain/usecase 禁止 import i18n(文案是呈现层职责)
'use strict'

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function propertyKeyName(node) {
  if (node.computed) return null
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal') return String(node.key.value)
  return null
}

function isStringLiteral(node) {
  return (
    node &&
    (node.type === 'Literal' || node.type === 'StringLiteral') &&
    typeof node.value === 'string'
  )
}

const markerLiteral = {
  meta: {
    type: 'problem',
    docs: { description: 'i18n 标记的源串必须是字符串字面量' },
    messages: {
      dynamic:
        'i18n marker argument must be a string literal so the extractor can find it (got {{kind}}).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return
        const name = node.callee.name
        // i18n('源串', ...) 或 translate(locale, '源串', ...)
        const source =
          name === 'i18n' ? node.arguments[0] : name === 'translate' ? node.arguments[1] : undefined
        if (source === undefined) return
        if (!isStringLiteral(source)) {
          context.report({
            node: source ?? node,
            messageId: 'dynamic',
            data: { kind: source.type },
          })
        }
      },
    }
  },
}

const noCjkLiteral = {
  meta: {
    type: 'problem',
    docs: { description: '用户可见面禁止裸中文字面量(应使用 i18n 标记)' },
    messages: {
      cjk: 'User-facing string must be wrapped in an i18n marker; raw CJK literal found.',
    },
  },
  create(context) {
    function insideDetail(node) {
      let cur = node.parent
      while (cur) {
        if (cur.type === 'Property' && propertyKeyName(cur) === 'detail') return true
        cur = cur.parent
      }
      return false
    }
    function report(node) {
      if (!insideDetail(node)) context.report({ node, messageId: 'cjk' })
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string' && CJK_RE.test(node.value)) report(node)
      },
      TemplateLiteral(node) {
        const text = node.quasis.map((q) => q.value.raw).join('')
        if (CJK_RE.test(text)) report(node)
      },
    }
  },
}

const noCoreImport = {
  meta: {
    type: 'problem',
    docs: { description: 'domain/usecase 禁止 import @epinfresh/i18n(呈现层职责)' },
    messages: {
      coreImport:
        'i18n belongs to the presentation layer: domains/usecases must return error codes/data, not localized text.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (
          typeof source === 'string' &&
          (source === '@epinfresh/i18n' || source.startsWith('@epinfresh/i18n/'))
        ) {
          context.report({ node, messageId: 'coreImport' })
        }
      },
    }
  },
}

export default {
  rules: {
    'marker-literal': markerLiteral,
    'no-cjk-literal': noCjkLiteral,
    'no-core-import': noCoreImport,
  },
}
