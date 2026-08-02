import { ErrorResponse, PaginationQuery } from '@epinfresh/shared'
import { Elysia } from 'elysia'

export const commonModel = new Elysia({ name: 'common-model' }).model({
  ErrorResponse,
  PaginationQuery,
})
