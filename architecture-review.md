# 架构审查 — Epinfresh

## 概览

电商后端 monorepo：Bun + ElysiaJS + Drizzle ORM + PostgreSQL + Redis + BullMQ。

DDD 风格分层：`packages/`（基础设施）→ `domains/`（业务逻辑）→ `workflows/`（跨域编排）→ `apps/`（入口）。ESLint boundaries 强制执行依赖方向。

---

## 亮点

- **模块边界清晰**：`packages` → `domains` → `workflows` → `apps`，由 `eslint-plugin-boundaries` 硬约束
- **TypeBox 全链路校验**：HTTP 层自动校验入参，通过 `InferModelsMap` 将类型穿透到 service 层
- **Result 模式**：用 `neverthrow` 的 `Result<T,E>` 处理业务错误；Elysia macro 实现权限守卫（`isAuth` / `isAdmin`）
- **安全细节**：Pino 日志脱敏 auth/cookie 头；登录时用假哈希做常数时间比对防用户枚举；argon2id 密码哈希
- **运维成熟**：优雅退出 + 10s 超时强杀；启动时 env 校验、报错信息明确；Docker Compose 完整本地栈；健康检查端点

---

## 安全（优先修复）

### 1. Session Fixation（会话固定）
**文件:** `packages/session/src/sessionPlugin.ts`

登录时未重新生成 session ID。如果攻击者事先种了一个已知的 `session_id` cookie，用户登录后该 cookie 即被认证。

**修复:** 在登录 handler 中先调用 `sessionStore.destroy(旧sessionId)`，再调用 `sessionStore.create(...)`；或在 `SessionStore` 中增加 `regenerate()` 方法。

### 2. Cookie `secure` 标志未强制
**文件:** `packages/session/src/sessionPlugin.ts`

`setSessionCookie` 将 `secure` 交由调用者决定——生产环境中如果误传 `false`，session cookie 将在 HTTP 明文传输。`clearSessionCookie` 完全未设置 `secure`，清除带 `secure` 的 cookie 可能失败。

**修复:** 两个函数内部直接根据 `NODE_ENV === 'production'` 强制设置 `secure`。

### 3. SameSite 逻辑颠倒
**文件:** `packages/session/src/sessionPlugin.ts`

生产用 `lax`，开发用 `strict`。开发和生产的 CSRF 行为不一致，无法在本地复现生产环境的 CSRF 问题。

**修复:** 统一使用相同值，或生产也用 `strict`。

---

## 架构

### 4. `initDb` / `initRedis` 竞态条件
**文件:** `packages/database/src/index.ts:54-74`、`packages/session/src/redis.ts:24-32`

两处都是"先检查再创建"的单例模式。并发调用时可能多个调用方同时通过 `if (!instance)` 检查，创建多个连接池，第一个池泄漏。

**修复:** 用 Promise 锁保护：

```ts
let initPromise: Promise<InitResult> | null = null
export function initDb(...) {
  if (initPromise) return initPromise
  initPromise = actuallyInit()
  return initPromise
}
```

### 5. 产品列表 N+1 查询
**文件:** `domains/product/src/service.ts`（`listAllProducts`、`listPublishedProducts`）

`db.query.products.findMany({ with: { skus: true } })` 在 Drizzle 的 `findMany` 实现中可能为每个产品单独查询 SKU。20 条产品 = 21 次查询。

**修复:** 确认 Drizzle 实际 SQL 输出。如果是 N+1，改用 join 查询或批量查 SKU。

### 6. 两套 API 入口 ~85% 重复
**文件:** `apps/api-storefront/src/index.ts`、`apps/api-admin/src/index.ts`

两套 app 共享完全相同的启动流程（`loadEnv → initDb → initRedis → 中间件链 → plugins → health → listen`）、相同的 CORS 配置、相同的 `onError` 处理器，以及几乎一致的 `shutdown()` 函数。

**修复:** 在 `packages/shared` 抽一个 `createApiApp(options)` 工厂：

```ts
createApiApp({
  port: env.STOREFRONT_PORT,
  plugins: [userStorefrontPlugin, productStorefrontPlugin, checkoutPlugin],
  enableDocs: true,
})
```

### 7. 分页逻辑 3 处复制
**文件:** `domains/product/src/service.ts`（`listAllProducts`、`listCategories`）、`domains/user/src/service.ts`（`listUsers`）

完全相同的 `(page - 1) * pageSize` + `select({ count })` + `limit/offset` 模式。

**修复:** 在 shared 抽 `paginate(db, table, opts)` 公共 helper。

---

## 代码质量

### 8. Result 使用不一致——未处理的 DB 错误变为 500
**文件:** `domains/user/src/service.ts`（`registerUser`）、`domains/product/src/service.ts`（`createProduct`、`createCategory`）

这些写操作直接返回原始数据而非 `Result`。唯一约束冲突（重复 email、重复 slug）会抛出未捕获异常 → HTTP 500，而非友好的 4xx 错误。

**修复:** 要么用 `Result` 包裹，要么加 try/catch 并用 shared 里的 `mapDbError` 兜底。

### 9. `updateProduct` 事务内冗余查询
**文件:** `domains/product/src/service.ts`

事务中已执行 `UPDATE ... RETURNING`（返回更新后的产品），随后又查一次 SKU——但 `updateProduct` 并不修改 SKU。

**修复:** 删除事务内的 SKU 重新查询。

### 10. `RegisterInput.email` 缺少 `format: 'email'`
**文件:** `domains/user/src/model.ts`

`LoginInput.email` 有 `format: 'email'` 校验，`RegisterInput.email` 没有。无效邮箱会直接进入数据库。

**修复:** 在注册 schema 中加上 `t.String({ format: 'email' })`。

### 11. `reduceProductStock` TOCTOU 竞态
**文件:** `domains/product/src/service.ts:54-76`

`gte(stock, quantity)` 的 UPDATE 是原子的。但当它返回 0 行时，第二次 SELECT 在事务外执行，用于区分 `SKU_NOT_FOUND` 还是 `INSUFFICIENT_STOCK`。两次查询之间另一个线程可能插入/补货该 SKU，导致返回错误的错误码。

**修复:** 放入事务，或在同一事务内先查存在再受控更新。

---

## 低优先级 / 小问题

- **无测试**：仓库零测试文件。核心路径（登录、下单、库存扣减）至少应有集成测试。
- **死代码**：`packages/shared/src/logger.ts` 中的 `LogLevel` 类型和 `ALLOWED` Set 声明后未使用。
- **CSP 头缺失**：`securityHeaders.ts` 设置了 `nosniff`、`DENY`、HSTS、referrer-policy，但缺 `Content-Security-Policy`。
- **`db` Proxy 缺少 trap**：仅拦截了 `get`。`set`、`has`、`ownKeys` 绕过守卫。`Object.keys(db)` 或 `delete db.xxx` 会直接操作空的 proxy target。
- **`neverthrow` 冗余直接依赖**：`domains/product/package.json` 和 `domains/user/package.json` 中列了 `neverthrow` 为直接依赖，但所有导入均通过 `@epinfresh/shared`。
- **Worker 缺退出超时**：API app 有 10s 超时强杀机制，worker 没有。
- **无启动健康检查**：`initDb`/`initRedis` 即时成功（连接池惰性创建），数据库挂了只有首次请求时才暴露。
- **secret 无法轮换**：`SESSION_SECRET` 是单一值，轮换会踢掉所有在线用户。
- **`listCategories` 类型过松**：service 签名是 `{page: number; pageSize: number}` 而非模型里的 `CategoryListQuery`。
- **Session 和限流共用一个 Redis**：限流 key 驱逐与 session 数据竞争内存和 CPU。
- **无滑动过期**：Session 创建 24 小时后精确过期，不活跃也不会延长。
- **Session 数据明文存 Redis**：无静态加密。

---

## 总结

基础扎实：类型安全的 tech stack、清晰的领域划分、成熟的运维工具链。主要差距：

1. **Session fixation** + **Cookie 标志不规范**（安全）
2. **initDb/initRedis 连接池竞态**（可靠性）
3. **写操作的错误处理不一致**（健壮性）
4. **缺少测试**（信心）

以上问题在当前的代码规模下修复成本都不高。
