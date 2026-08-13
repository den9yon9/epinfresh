import { err, type Result } from '@epinfresh/shared'

import type { DbClient, DbTransaction } from './index'

// 事务内返回 err() 的语义由本 helper 统一处理：
// drizzle 的 client.transaction 只有回调抛异常才回滚，直接 return err() 会被当正常结果提交。
// withTransaction 把 err 转成内部 abort（抛异常→回滚），在边界再还原为 err()。
// 非 Result 异常（DB 错误、业务 throw）原样上抛，保持回滚。
class TransactionAbort<C extends string> extends Error {
  constructor(readonly code: C) {
    super(String(code))
    this.name = 'TransactionAbort'
  }
}

function isResult(value: unknown): value is Result<unknown, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isErr' in value &&
    typeof (value as { isErr: unknown }).isErr === 'function'
  )
}

export async function withTransaction<T, C extends string>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<Result<T, C>>,
): Promise<Result<T, C>>
export async function withTransaction<T>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T>
export async function withTransaction<T, C extends string>(
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
    if (caught instanceof TransactionAbort) return err(caught.code)
    throw caught
  }
}
