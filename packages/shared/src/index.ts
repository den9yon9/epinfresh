// ponytail: shared 是纯工具包(零 elysia); domain 常量 (USER_ROLE/PRODUCT_STATUS) 暂留,
// 若 database schema 也想零依赖,再拆 @epinfresh/domain-types
export {
  USER_ROLE,
  type UserRole,
  PRODUCT_STATUS,
  type ProductStatus,
} from './constants'
export { parseEnv } from './env'
export { type Result, ok, err } from 'neverthrow'
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQuery,
  PaginatedResponse,
  ErrorResponse,
} from './schemas'
export type { ErrorContract } from './errors'
export { createLogger, type Logger } from './logger'
export { hashPassword, verifyPassword } from './crypto'
