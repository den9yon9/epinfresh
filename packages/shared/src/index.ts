export { hashPassword, verifyPassword } from './crypto'
export { parseEnv } from './env'
export { createLogger, type Logger } from './logger'
export { fromCents, toCents } from './money'
export { getRequestContext, getRequestId, runWithRequestId } from './requestContext'
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  ErrorResponse,
  MAX_PAGE_SIZE,
  PaginatedResponse,
  PaginationQuery,
} from './schemas'
export { err, ok, type Result } from 'neverthrow'

// 不变量破坏哨兵: "不该发生"的失败专用。业务失败走 err(); 本类抛出后由
// withTransaction/路由原样上抛(回滚 + 500), name 可检索可告警。
// 与 assertNever 同族: 一个管编译期的不可能, 一个管运行时的不可能。
export class InvariantViolation extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Invariant violated: ${message}`, options)
    this.name = 'InvariantViolation'
  }
}

export function assertNever(code: never): never {
  throw new Error(`[controller] unhandled error code: ${code}`)
}
