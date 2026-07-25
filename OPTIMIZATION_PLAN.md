# epinfresh 架构优化计划

基于对当前代码库的审查,梳理出以下可优化项。

## 架构决策(已确认)

- **错误响应策略:** 业务错误(如 `USER_NOT_FOUND`、`PRODUCT_NOT_FOUND` 等 `Result` 错误码)通过路由的 `response: { 4xx: 'ErrorResponse' }` 声明,经 Eden 类型透传到前端;服务错误(500)、校验错误(400)遵循 Elysia 默认行为,不做额外格式化。因此 app 级 `onError`、Service 统一 Result、switch 兜底等均暂不改动。
- **测试体系:** 暂不引入。

## 审查结论(做得好的地方)

- 方法链式调用完整,无断链丢类型
- 所有插件都带 `name` 做去重(`user-www`、`session`、`request-logger` 等)
- Controller 用 Elysia 实例,Service 为静态类,handler 内联解构传参
- 模型按名引用(`body: 'RegisterInput'`),并导出推断类型
- `requestLogger` 用 `as: 'global'` 全局生命周期
- `@sinclair/typebox` 版本对齐(0.34.52),env 用 TypeBox + Transform 校验
- Service 返回 `status()` 而非 throw

---

## Phase A — 废弃依赖清理(零风险,先行)

**目标:** 移除 `@elysiajs/cookie`,改用 Elysia 1.4 内置 cookie。

| 步骤 | 文件 | 改动 |
|------|------|------|
| A1 | `domains/session/package.json:12` | 删除 `"@elysiajs/cookie"` 依赖 |
| A2 | `domains/session/src/sessionPlugin.ts:1` | 删除 `import { cookie } from '@elysiajs/cookie'` |
| A3 | `domains/session/src/sessionPlugin.ts:33` | 删除链中的 `.use(cookie())` |
| A4 | 根目录 | `pnpm install` 更新 lockfile |

内置 `ctx.cookie?.session_id?.value` 与 `cookie.set(...)` 已在用,零行为变化。

---

## Phase B — 模型命名空间(低风险, foundational)

**目标:** 消除 `ErrorResponse` 跨域冲突,补齐类型导出,清未用 import。

### B1. 新增共享 `commonModel` 插件

`packages/shared/src/commonModel.ts`(新文件):

```ts
import { Elysia } from 'elysia'
import { ErrorResponse, PaginationQuery } from './schemas'

// ErrorResponse / PaginationQuery 在 app 根注册一次,所有域按名引用
export const commonModel = new Elysia({ name: 'common-model' }).model({
  ErrorResponse,
  PaginationQuery,
})
```

在 `packages/shared/src/index.ts` 导出 `commonModel`。

### B2. 域模型加命名空间前缀

- `domains/user/src/model.ts:13` 在 `.model({...})` 后链 `.prefix('model', 'User')` → 模型名变 `User.RegisterInput`、`User.UserResponse` 等
- `domains/product/src/model.ts:25` 同理 `.prefix('model', 'Product')`
- 两处删除 `ErrorResponse` 行(user `:31`、product `:42`),改由 app 根 `commonModel` 提供
- 删除 `domains/product/src/model.ts:9` 未用的 `Static` import

### B3. 更新路由模型引用

各 `www.ts`/`admin.ts` 中:

- `'RegisterInput'` → `'User.RegisterInput'`,`'UserResponse'` → `'User.UserResponse'`,`'UserListQuery'` → `'User.UserListQuery'`,`'UserListResponse'` → `'User.UserListResponse'`
- `'CreateProductInput'` → `'Product.CreateProductInput'`,product 系列同理
- `'ErrorResponse'` 保持原名(由 app 根 commonModel 提供)

### B4. app 根注册 commonModel

`apps/api-www/src/index.ts:17` 和 `apps/api-admin/src/index.ts:17` 在 `requestLogger()` 之后、域插件之前加 `.use(commonModel)`。

> ⚠️ **验证点:** 确认 Elysia 跨插件模型名解析——域插件内路由引用 `'ErrorResponse'` 时,能否解析到 app 根 commonModel 注册的同名模型。若不能,退回方案:各域保留 `ErrorResponse` 但前缀后变 `User.ErrorResponse`/`Product.ErrorResponse`,路由引用全名。先用 `app.handle()` 跑一个 404 路由验证再推进。

### B5. 补齐 ProductModel 类型导出

`domains/product/src/index.ts` 加 `export type { ProductModel } from './model'`(对齐 user 域 `:5`)。

---

## Phase C — 鉴权改造为 macro(核心,收益最高)

**目标:** 消除所有 `as Session` 强转,`session`/`sessionStore` 类型自动流入;user 域不再穿透抓 Redis。

### C1. 重构 `createSessionPlugin`

`domains/session/src/sessionPlugin.ts`:

- derive `session: Session | null`(保留,供未守护路由)
- **新增** derive `sessionStore`(用 `lazyRedis()` 内部构造),移除 `domains/user/src/www.ts:18-20` 的自建 derive
- 这样 user 域只需 `session`/`sessionStore` 上下文属性,不再 import `getRedis`/`createSessionStore`

### C2. 引入鉴权 macro(替代 `requireRole`/`requireAdmin`/`requireSession`)

`domains/session/src/sessionPlugin.ts` 新增导出 `authMacro` 插件:

```ts
export const authMacro = new Elysia({ name: 'auth-macro' }).macro({
  isAuth: {
    async resolve({ session, status }) {
      if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
    },
  },
  isAdmin: {
    async resolve({ session, status }) {
      if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
      if (session.role !== 'admin') return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
    },
  },
})
```

- 删除 `requireRole`/`requireAdmin`/`requireSession`(`:104-124`)及 `unauthorized`/`forbidden` 辅助
- `domains/session/src/index.ts` 更新导出

### C3. www 路由改用 macro

`domains/user/src/www.ts`:

- `.use(authMacro)`
- `/me`:`.get('/me', ({ session }) => {...}, { isAuth: true, response: {...} })` —— 删除 `:63` 的 `const session = s as Session | null`
- `/logout`:可加 `{ isAuth: true }`(当前逻辑已判 null)
- `/login` 路由级 `rateLimit` 选项处理见 Phase D

### C4. admin 全局守护改类型安全 guard

`apps/api-admin/src/index.ts:21-22`:

```ts
.use(createSessionPlugin())
.use(authMacro)
.onBeforeHandle(({ session, status }) => {
  if (!session) return status(401, { error: 'UNAUTHORIZED', message: 'Unauthorized' })
  if (session.role !== 'admin') return status(403, { error: 'FORBIDDEN', message: 'Forbidden' })
})
.use(userAdminPlugin)
.use(productAdminPlugin)
```

`session` 因 `createSessionPlugin` derive 而有类型,无需 `Record<string,unknown>` 强转。删除 `requireAdmin` import。

> **取舍说明:** 全局 guard 比 per-route `{ isAdmin: true }` 更 DRY(admin 所有路由都要鉴权),且 `onBeforeHandle` 在 derive 之后 ctx 已带类型,满足 skill "类型安全" 要求。若更想要纯 macro 风格(per-route 显式),可改为给每个 admin 路由加 `{ isAdmin: true }`——更冗余但更显式。当前倾向混合方案。

---

## Phase D — 迁移与路由规范

### D1. 迁移抽离,避免并发

- `packages/database` 新增 `src/migrate.ts` 独立脚本(或复用 `runMigrations` 加 PG advisory lock `pg_advisory_lock`)
- `packages/database/package.json` 加 `"migrate": "bun --env-file=../../.env src/migrate.ts"`
- `turbo.json` 加 `"migrate": { "cache": false }` task
- 根 `package.json` `dev` 脚本改为 `"turbo migrate && turbo dev"`
- 删除 `apps/api-www/src/index.ts:13` 与 `apps/api-admin/src/index.ts:13` 的 `runMigrations()` 调用

### D2. 路由前缀/尾斜杠统一

`domains/user/src/admin.ts:5` 改为对齐 productAdmin 风格:

```ts
new Elysia({ name: 'user-admin', prefix: '/api/v1/admin' })
  .get('/users', ...)
  .get('/users/:id', ...)
```

(当前 `prefix: '/api/v1/admin/users'` + `.get('/')` 产生尾斜杠)

### D3. 限流策略确认

核查 `elysia-nazli` 是否支持路由级 `rateLimit` 选项(macro 注册):

- 若**支持**:`domains/user/src/www.ts:43` 的 `rateLimit: { limit: 10, window: '60s' }` 生效,但与 `:17` 的插件级限流叠加——改为只对 `/login` 用更严的限流,移除 `:17` 全局 auth 限流,或调高全局阈值
- 若**不支持**:该选项被静默忽略——改为对 `/login` 单独挂一个 `authRateLimit({ limit: 10, window: '60s' })` 子实例

---

## Phase E — 架构增强(可选,较大)

### E1. OpenAPI 文档

两个 app 加 `@elysiajs/openapi`,挂 `/docs` 端点,复用已有 `detail.tags`。启动时还能暴露模型名冲突(Phase B 的验证兜底)。

### E2. session 域结构规范

`DEVELOPMENT_PLAN.md` 注明 session 为**基础设施域**,不适用 `model/service/www/admin` 五件套。可选:把 `SessionSchema` 提到 `model.ts` 并 `.model({ Session })` 注册,使其进入 OpenAPI。

---

## 实施顺序与依赖

```
A (cookie 清理) ──┐
                  ├─► B (模型命名空间) ──► C (鉴权 macro)
                  │                              │
                  └─► D (迁移/路由/限流) ◄───────┘
                         │
                         ▼
                      E (OpenAPI / session 规范)
```

A、B、D 互相独立可并行;C 依赖 B(模型引用稳定)。建议按 A → B → D → C → E 推进。

## 风险与验证

- **B4** 跨插件模型名解析——需 `app.handle()` 验证,失败有退回方案
- **C** macro + derive 类型推断——`tsc --noEmit` 全量类型检查
- 每个 Phase 完成后跑 `pnpm typecheck && pnpm lint`,C 完成后手动验证登录/登出/admin 鉴权流程
