export interface DbErrorMapping {
  status: number
  body: { error: string; message: string }
}

// Postgres SQLSTATE codes (duck-typed via `code` prop on postgres-js errors)
// 23505 unique_violation, 23503 foreign_key_violation, 23502 not_null_violation
export function mapDbError(err: unknown): DbErrorMapping | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return null
  switch (code) {
    case '23505':
      return { status: 409, body: { error: 'CONFLICT', message: 'Resource already exists' } }
    case '23503':
      return {
        status: 400,
        body: { error: 'INVALID_REFERENCE', message: 'Referenced resource does not exist' },
      }
    case '23502':
      return { status: 400, body: { error: 'MISSING_FIELD', message: 'Required field is missing' } }
    default:
      return null
  }
}
