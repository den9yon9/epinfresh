// eden treaty 类型提取工具 (与 storefront-web 同款)
// 全部类型源自 eden 契约（= 后端 TypeBox schema 推导），零运行时成本

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 类型工具必须放宽签名以接受 treaty 具体方法
export type EdenMethod = (...args: any[]) => Promise<any>

// 响应数据类型提取
export type EdenData<T extends EdenMethod> = NonNullable<Awaited<ReturnType<T>>['data']>
// 列表响应（项目约定 PaginatedResponse{ items, total, page, pageSize }）元素类型
export type EdenListItem<T extends EdenMethod> = EdenData<T>['items'][number]

// 动态段子路径方法类型是交叉类型, 无法过 EdenMethod 约束, 用条件推断提取
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 类型工具必须放宽签名
export type EdenApiData<T> = T extends (...args: any[]) => infer R
  ? NonNullable<Awaited<R> extends { data: infer D } ? D : never>
  : never
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 类型工具必须放宽签名
export type EdenApiBody<T> = T extends (body: infer B, ...rest: any[]) => unknown
  ? NonNullable<B>
  : never

// 请求参数类型提取
// body：仅 POST/PUT/PATCH/DELETE 系列（两参签名）可取；GET/HEAD 单参签名 → never，误用即编译失败
export type EdenBody<T extends EdenMethod> =
  Parameters<T> extends [infer B, unknown, ...unknown[]] ? B : never
// options（含 query/headers/fetch）：POST 系列第二参，GET 系列第一参
export type EdenOptions<T extends EdenMethod> =
  Parameters<T> extends [unknown, infer O, ...unknown[]]
    ? O
    : Parameters<T> extends [infer O]
      ? O
      : never
export type EdenQuery<T extends EdenMethod> =
  EdenOptions<T> extends { query?: infer Q } ? NonNullable<Q> : never
