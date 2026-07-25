import { Elysia } from 'elysia'
import { ErrorResponse, PaginationQuery } from './schemas'

export const commonModel = new Elysia({ name: 'common-model' }).model({
  ErrorResponse,
  PaginationQuery,
})
