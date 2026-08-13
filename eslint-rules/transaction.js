// ESLint 本地插件: 强制 domains/usecases 事务入口统一走 withTransaction
//
// 背景: drizzle 的 client.transaction 只有回调抛异常才回滚, 直接 return err()
// 会被当正常结果提交(静默提交部分写入)。packages/database 的 withTransaction
// 把回调内 return err() 转成内部 abort(回滚) 再在边界还原为 err(), 语义安全。
// 本规则封死绕过 helper 的路径: domains/usecases 内禁止直接调用 .transaction()。
'use strict'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid raw .transaction() calls in domains/usecases; use withTransaction',
    },
    messages: {
      rawTransaction:
        'Raw `.transaction()` is forbidden in domains/usecases: returning err() inside the callback would COMMIT instead of roll back. Use `withTransaction(client, fn)` from @epinfresh/database.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') return
        if (callee.property.type !== 'Identifier') return
        if (callee.property.name !== 'transaction') return

        context.report({ node, messageId: 'rawTransaction' })
      },
    }
  },
}

export default { rules: { 'use-with-transaction': rule } }
