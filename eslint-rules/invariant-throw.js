// ESLint 本地插件: 禁止 domains/usecases 生产代码裸 `throw new Error(...)`
//
// 背景: 事务内不变量破坏(如取消订单恢复库存失败)需要 throw 触发回滚——withTransaction
// 对非 Result 异常原样上抛。但裸 Error 没有身份: 监控里与"数据库宕机"这类环境故障无法
// 区分(前者要人工介入, 后者重启即可), 代码里也无法 grep"哪些地方郑重声明了不变量"。
// 约定:
//   - 业务失败 → return err('CODE')(进错误契约, 调用方穷举处理)
//   - 不该发生的失败 → throw new InvariantViolation(...)(packages/shared, 自文档化可告警)
// env.ts 豁免: 环境配置错误是独立失败类别(启动时 fail-fast), 保留裸 Error。
'use strict'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid bare `throw new Error(...)` in domains/usecases; return err() for business failures, throw InvariantViolation for broken invariants',
    },
    messages: {
      bareThrow:
        'Bare `throw new Error(...)` is forbidden: business failures return err(); impossible states throw new InvariantViolation(...) from @epinfresh/shared.',
    },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        const arg = node.argument
        if (arg?.type !== 'NewExpression') return
        if (arg.callee.type !== 'Identifier' || arg.callee.name !== 'Error') return
        context.report({ node: arg, messageId: 'bareThrow' })
      },
    }
  },
}

export default { rules: { 'no-bare-throw': rule } }
