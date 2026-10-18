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

// 错误响应统一通用形态, 前端以 toast 消费为主, 不做按码的字面量判别联合
// (少数需按码/按 payload 分支的端点在各自 model 里单独建模, 如 checkout 的 409)。
export const ErrorResponse = Type.Object({
  error: Type.String(),
  message: Type.String(),
})
