# AGENTS.md — AI agent 协作约束

本文档供 AI 编码助手（opencode 等）在本仓库工作时遵循。人类贡献者详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 项目定位

领域驱动电商后端 monorepo。Bun + ElysiaJS + Drizzle + PostgreSQL + Redis。C 端（api-www:3000）/ B 端（api-admin:3001）分进程。

## 依赖拓扑（硬规则，违反即错）

```
shared (叶)  ←  database, session (兄弟基础设施，互不依赖)
              ←  user, product (业务域，互不依赖)
              ←  apps (装配层)
```

- **禁止** `session` 依赖 `database`，反之亦然。`session` 保持 DB-free（仅 Redis）。
- **禁止**业务域互相 import（`user` ↔ `product`）。域组合由 `apps/*` 的 `.use()` 完成。
- **禁止** `apps/*` 写业务逻辑，只做装配。
- `USER_ROLE` / `PRODUCT_STATUS` 等**跨层枚举定义在 `@epinfresh/shared`**（`src/constants.ts`）。`database` 的 `pgEnum` 从 shared 派生，`session` 从 shared 消费。**禁止**把枚举搬到 `database`（会破坏 session 的 DB-free 定位）。

## Elysia 编码硬规则

- **必须链式调用**，不拆开赋值再调方法（丢类型）。
- 所有被 `.use()` 的插件**必须** `{ name: '...' }` 去重。
- model 注册后**按字符串名引用**（`body: 'User.RegisterInput'`），业务域 model **必须** `.prefix('model', '<Domain>')`。
- `ErrorResponse` / `PaginationQuery` 由 app 根 `commonModel` 提供，**禁止**业务域重复注册 `ErrorResponse`。
- 鉴权用 `createSessionPlugin()` 的 macro（`isAuth` / `isAdmin`），**禁止** `as Session` 强转。
- handler **内联解构** context 传给 Service，**禁止**传整个 `Context`。
- Service **静态类**，返回 `Result`（`ok`/`err('CODE')`），**禁止** `throw` 业务错误。
- 路由用 `.match()` 把 `err` 映射为 `status(4xx, { error, message })`。500/400 走 Elysia 默认。
- app 装配顺序：`requestLogger → cors → openapi(/docs) → commonModel → /health → [session+guard 仅 admin] → 业务插件 → listen`。
- `/health`、`/docs` 必须在鉴权守卫之前注册。

## 分层文件约定

- 业务域五件套：`model.ts` / `service.ts` / `www.ts` / `admin.ts` / `index.ts`。
- `session` 是基础设施域，不适用五件套（`sessionPlugin.ts` / `redis.ts` / `rateLimit.ts` / `index.ts`）。
- model 从 `@epinfresh/database` 的 `table.select/insert/update` 派生，**禁止**手写与 DB schema 重复的字段。
- 包 `main`/`types` 指向 `src/index.ts`（源码即入口）。

## 命名与路径

- 包名一律 `@epinfresh/<name>`，workspace 依赖写 `"workspace:*"`。
- 路由前缀：C 端 `/api/v1`（认证 `/api/v1/auth`），B 端 `/api/v1/admin`。
- B 端 prefix 到 `/admin`，资源名放路径（`/products`），**禁止** `prefix:'/api/v1/admin/users'` + `.get('/')`。
- `detail.tags`：C 端 `<Resource>`，B 端 `Admin/<Resource>`。
- tsconfig 一律 `extends: "../../config/tsconfig/base.json"` + `outDir: "./dist"` + `include: ["src"]`。

## 数据库

- 主键 `uuid` + `defaultRandom()`；时间戳 `timestamp({ withTimezone: true })` + `.$onUpdate`。
- 金额 `decimal({ precision: 10, scale: 2 })`，按字符串处理，**禁止** float。
- 改 schema 后**必须** `pnpm --filter @epinfresh/database db:generate` 生成迁移，再 `db:migrate`，提交生成的 `*.sql` + `meta/*`。
- **禁止**手编 `src/migrations/meta/*`，**禁止**修改历史迁移。
- 迁移由 `turbo migrate` 前置，**禁止**在 app 启动路径内 `runMigrations()`。

## 环境变量

- `.env.example` 是单一事实源。新增变量**必须**同步更新 `.env.example` + `packages/shared/src/env.ts` 的 TypeBox schema。
- **禁止**裸读 `process.env.X`，必须经 `loadEnv(schema)`。

## 日志

- 用 `@epinfresh/shared` 的 `logger`（pino），**禁止** `console.log` 做业务日志。
- 两个 app **必须** `.use(requestLogger())` 在装配链最前。
- cookie / authorization 已被 pino redact，**禁止**明文打日志。

## 代码风格

- Biome：2 空格、单引号、无分号、行宽 100。
- **禁止**提交未用 import / 变量。
- **禁止**为业务源码新增 biome ignore。

## Git

- Conventional Commits（commitlint 强制）：`<type>(<scope>): <subject>`。
- lefthook pre-commit 自动 `biome check --write`，commit-msg 跑 commitlint。

## 提交前必跑

```bash
pnpm typecheck && pnpm lint && pnpm build
```

CI 会跑 `pnpm check && pnpm typecheck && pnpm build`，本地务必先过。

## 改动禁区

- `packages/database/src/migrations/meta/*`（生成物）
- `.turbo/`、`dist/`、`node_modules/`、`biome-logs/`
- `pnpm-lock.yaml`（由 `pnpm install` 维护，不手改）
- 历史迁移文件（只能新增）
