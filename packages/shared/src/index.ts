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

export function assertNever(code: never): never {
  throw new Error(`[controller] unhandled error code: ${code}`)
}
