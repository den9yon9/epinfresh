// ESLint 本地插件: 强制 err() 错误码为大写下划线格式 (SCREAMING_SNAKE)
//
// 背景: 错误码字符串化后, 类型系统不再约束码的形态(对象形态时代码名受判别联合
// 命名约束)。域/用例层错误码是 API 契约的一部分, 小写/空格会破坏跨层一致性,
// 故用本规则守住 `^[A-Z][A-Z0-9_]*$` 纪律。
// 只检查字符串字面量实参; err(result.error) / err({ code, ... }) 等非字面量自动跳过。
'use strict'

const CODE_RE = /^[A-Z][A-Z0-9_]*$/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce SCREAMING_SNAKE error codes passed to err()',
    },
    messages: {
      badFormat:
        'Error code "{{code}}" must be SCREAMING_SNAKE (e.g. SKU_NOT_FOUND); lowercase codes weaken the error contract.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'Identifier') return
        if (callee.name !== 'err') return
        const first = node.arguments[0]
        if (!first || first.type !== 'Literal' || typeof first.value !== 'string') return

        if (!CODE_RE.test(first.value)) {
          context.report({ node: first, messageId: 'badFormat', data: { code: first.value } })
        }
      },
    }
  },
}

export default { rules: { 'screaming-snake': rule } }
