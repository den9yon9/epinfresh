import type { DomainError } from './errors'

export type HttpStatus = {
  statusCode: number
  body: { error: string; message?: string }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function toHttpStatus(err: DomainError): HttpStatus {
  switch (err.kind) {
    case 'NotFound':
      return { statusCode: 404, body: { error: 'NOT_FOUND', message: `${err.entity} not found` } }
    case 'Conflict':
      return { statusCode: 409, body: { error: err.code, message: err.message } }
    case 'InvalidCredentials':
      return {
        statusCode: 401,
        body: { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      }
    case 'Forbidden':
      return { statusCode: 403, body: { error: 'FORBIDDEN', message: 'Forbidden' } }
    case 'Unauthorized':
      return { statusCode: 401, body: { error: 'UNAUTHORIZED', message: 'Unauthorized' } }
    case 'ValidationError':
      return {
        statusCode: 422,
        body: {
          error: 'VALIDATION',
          message: err.message,
          ...(err.field ? { field: err.field } : {}),
        },
      }
    case 'Internal':
      return { statusCode: 500, body: { error: 'INTERNAL', message: err.message } }
  }
}
