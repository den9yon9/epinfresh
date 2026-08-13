import { err, type Result } from '@epinfresh/shared'

import type { DbClient, DbTransaction } from './index'

// 事务内返回 err() 的语义由本 helper 统一处理：
// drizzle 的 client.transaction 只有回调抛异常才回滚，直接 return err() 会被当正常结果提交。
// withTransaction 把 err 转成内部 abort（抛异常→回滚），在边界再还原为 err()。
// 非 Result 异常（DB 错误、业务 throw）原样上抛，保持回滚。
// 错误类型 C 不做约束：域层约定为字符串错误码或 { code, ...payload } 对象（见 CONTRIBUTE.md
// 错误码约定），但 helper 本身不限制，将来传任意结构化错误都可用。
class TransactionAbort<C> extends Error {
  constructor(readonly code: C) {
    super(typeof code === 'string' ? code : JSON.stringify(code))
    this.name = 'TransactionAbort'
  }
}

// 双方法探测: 真正的 neverthrow Result 同时具备 isOk/isErr 方法。
// 只查单个键会把恰好带 isErr 字段/方法的普通业务对象误判为 Result, 导致静默回滚。
function isResult(value: unknown): value is Result<unknown, unknown> {
  if (value === null || typeof value !== 'object') return false
  const v = value as { isOk?: unknown; isErr?: unknown }
  return typeof v.isOk === 'function' && typeof v.isErr === 'function'
}

export async function withTransaction<T, C>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<Result<T, C>>,
): Promise<Result<T, C>>
export async function withTransaction<T>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T>
export async function withTransaction<T, C>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<Result<T, C> | T>,
): Promise<Result<T, C> | T> {
  try {
    const value = await client.transaction(async (tx) => {
      const result = await fn(tx)
      if (isResult(result) && result.isErr()) {
        throw new TransactionAbort(result.error)
      }
      return result
    })
    return value
  } catch (caught) {
    if (caught instanceof TransactionAbort) return err(caught.code as C)
    throw caught
  }
}
