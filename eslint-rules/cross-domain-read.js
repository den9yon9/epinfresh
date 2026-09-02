// ESLint 本地插件: 跨域读约束(域内自洽, 跨域取数经域函数/usecase 编排)
//
// 背景: table-ownership 只管写, 读完全自由——但"行为性跨域读"(payment 读 orders 做业务
// 判断)与"展示关联读"(cart join product 显示商品名)都是耦合。约定: 域只许引用自己的表;
// apps 是薄壳, 不许直接引用任何表。跨域取数一律经域函数或 usecase 编排。
//
// 当前为 error 级(payment/cart 两处历史耦合已于 2026-09 重构清偿, 见 git log):
// 行为性读经 usecases 编排(payment-initiate), 展示读由读模型 usecase(cart-ops)拼装。
// apps 侧一直为 error 级: 生产代码应零表引用。
//
// 检查路径: 1) schema.<table>  2) <db>.query.<relation>(drizzle 关系查询)。
// 归属推导复用 table-ownership 的 loadTableOwnership(schema 目录名即归属域)。
// model.ts 的 table.select.* 类型派生不受影响(引用对象是 table 非 schema)。
'use strict'

import { loadTableOwnership } from './table-ownership.js'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid cross-domain table references in domains; forbid any table reference in apps',
    },
    messages: {
      crossDomainRead:
        'Referencing table "{{table}}" (owned by the "{{owner}}" domain) from the "{{domain}}" domain is forbidden. Fetch cross-domain data via domain functions or usecase orchestration.',
      appTableRef:
        'apps/ must not reference data tables directly. Route all reads/writes through domain/usecase functions.',
    },
  },
  create(context) {
    const domain = /\/domains\/([^/]+)\//.exec(context.filename)?.[1]
    const isApp = /\/apps\//.test(context.filename)
    if (!domain && !isApp) return {}

    const ownership = loadTableOwnership()

    function checkRef(prop, node) {
      if (prop?.type !== 'Identifier') return
      const table = prop.name
      if (isApp) {
        if (ownership.has(table)) {
          context.report({ node, messageId: 'appTableRef', data: { table } })
        }
        return
      }
      const owner = ownership.get(table)
      if (owner === undefined || owner === domain) return
      context.report({
        node,
        messageId: 'crossDomainRead',
        data: { table, owner, domain },
      })
    }

    return {
      MemberExpression(node) {
        // 路径 1: schema.<table>
        if (node.object?.type === 'Identifier' && node.object.name === 'schema') {
          checkRef(node.property, node)
          return
        }
        // 路径 2: <db>.query.<relation>
        if (
          node.property?.type === 'Identifier' &&
          node.object?.type === 'MemberExpression' &&
          node.object.property?.type === 'Identifier' &&
          node.object.property.name === 'query'
        ) {
          checkRef(node.property, node)
        }
      },
    }
  },
}

export default { rules: { 'no-cross-domain-refs': rule } }
