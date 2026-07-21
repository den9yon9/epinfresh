export type DomainError =
  | { kind: 'NotFound'; entity: string; id?: string }
  | { kind: 'Conflict'; code: ConflictCode; message: string }
  | { kind: 'InvalidCredentials' }
  | { kind: 'Forbidden' }
  | { kind: 'Unauthorized' }
  | { kind: 'ValidationError'; field?: string; message: string }
  | { kind: 'Internal'; message: string; cause?: unknown }

export type ConflictCode =
  | 'DUPLICATE_EMAIL'
  | 'DUPLICATE_SLUG'
  | 'DUPLICATE_SKU_CODE'
  | 'CATEGORY_HAS_PRODUCTS'
  | 'PRODUCT_HAS_ORDER'

export const notFound = (entity: string, id?: string): DomainError => ({
  kind: 'NotFound',
  entity,
  id,
})
export const conflict = (code: ConflictCode, message: string): DomainError => ({
  kind: 'Conflict',
  code,
  message,
})
export const invalidCredentials = (): DomainError => ({ kind: 'InvalidCredentials' })
export const forbidden = (): DomainError => ({ kind: 'Forbidden' })
export const unauthorized = (): DomainError => ({ kind: 'Unauthorized' })
export const validationError = (message: string, field?: string): DomainError => ({
  kind: 'ValidationError',
  field,
  message,
})
export const internal = (message: string, cause?: unknown): DomainError => ({
  kind: 'Internal',
  message,
  cause,
})

export function isDomainError(x: unknown): x is DomainError {
  return (
    typeof x === 'object' &&
    x !== null &&
    'kind' in x &&
    typeof (x as { kind: unknown }).kind === 'string'
  )
}
