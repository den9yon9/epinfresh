import { type Static, type TSchema, t } from 'elysia'

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export const PaginationQuery = t.Object({
  page: t.Number({ minimum: 1, default: DEFAULT_PAGE }),
  pageSize: t.Number({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE }),
})

export const PaginatedResponse = <T extends TSchema>(item: T) =>
  t.Object({
    items: t.Array(item),
    total: t.Number(),
    page: t.Number(),
    pageSize: t.Number(),
  })

export const ErrorResponse = t.Object({
  error: t.String(),
  message: t.String(),
})
