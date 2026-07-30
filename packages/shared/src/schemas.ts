import { type TSchema, Type } from '@sinclair/typebox'

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export const PaginationQuery = Type.Object({
  page: Type.Number({ minimum: 1, default: DEFAULT_PAGE }),
  pageSize: Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE }),
})

export const PaginatedResponse = <T extends TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item),
    total: Type.Number(),
    page: Type.Number(),
    pageSize: Type.Number(),
  })

export const ErrorResponse = Type.Object({
  error: Type.String(),
  message: Type.String(),
})
