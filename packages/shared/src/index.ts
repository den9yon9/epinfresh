// ponytail: debt — shared 是暂时性杂物间, 膨胀后按三条线拆分:
//   1. 领域类型 (USER_ROLE/PRODUCT_STATUS 这类跨 database/session/domain 的常量 → @epinfresh/domain-types)
//   2. 纯工具 (env/logger/schemas/errors, 无运行时绑定)
//   3. 运行时适配 (crypto 的 Bun.password、serverFactory、requestLogger)
export type { InferModel, InferModelsMap } from './InferModel'
export {
  USER_ROLE,
  type UserRole,
  PRODUCT_STATUS,
  type ProductStatus,
} from './constants'
export { baseEnvSchema, parseEnv, t } from './env'
export { type Result, ok, err } from 'neverthrow'
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQuery,
  PaginatedResponse,
  ErrorResponse,
} from './schemas'
export { commonModel } from './commonModel'
export { type ErrorContract, toError } from './errors'
export { createLogger, type Logger } from './logger'
export { requestLogger } from './requestLogger'
export { securityHeaders } from './securityHeaders'
export { mapDbError, type DbErrorMapping } from './dbError'
export { hashPassword, verifyPassword } from './crypto'
export { startServer, healthCheck } from './serverFactory'
