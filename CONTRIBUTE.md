# CONTRIBUTE.md

## 项目简介

epinfresh 是生鲜电商后端，pnpm + Turborepo Monorepo，Bun 运行时。

技术栈：

- **Web 框架**：ElysiaJS（类型安全、插件化）
- **ORM**：Drizzle + postgres.js，schema 校验用 TypeBox / drizzle-typebox（DB 与 API 契约单一来源）
- **队列**：BullMQ（Redis）
- **会话**：Redis 会话 + 签名 Cookie
- **错误处理**：neverthrow Result
- **工具链**：Biome（lint/format）、eslint-plugin-boundaries（分层约束）、lefthook（git hooks）、commitlint（提交规范）

## 目录结构

```
apps/                    # 可部署服务（薄壳：只做装配，不含业务逻辑）
├── api-storefront/      # 前台 API（端口 3000）
├── api-admin/           # 管理后台 API（端口 3001）
└── worker/              # BullMQ 消费者
domains/                 # 业务领域
├── user/                # domain-core：用户/认证
├── product/             # domain-core：商品/库存
└── checkout/            # domain-flow：下单流程（编排 domain-core）
packages/                # 基础设施包
├── database/            # package-data：schema、迁移、DbClient
├── shared/              # package-shared：纯工具（零 Elysia）
├── queue/               # package-queue：BullMQ 封装（领域的消息端口）
├── http/                # package-infra：Elysia 插件、服务工厂
├── session/             # package-infra：会话、限流
├── redis/               # package-infra：ioredis 封装
└── tsconfig/
```

依赖方向由 `eslint-plugin-boundaries` 在编译期强制（单向无环）：

```
package-data ← package-shared
                  ↖  domain-core(user/product) 可依赖 data/shared/queue
                  ↖  domain-flow(checkout)     可依赖 data/shared/queue + domain-core
                  ↖  app 可依赖一切上层
```

**domain-core / domain-flow 只允许依赖 `package-data` / `package-shared` / `package-queue`**；http/session/redis 对领域层封死。改动依赖关系必须同步修改 `eslint.config.js`（新增元素或调整白名单），并跑 `pnpm lint:boundaries` 验证。

## 环境要求

- Bun >= 1.2
- pnpm 10
- Docker（PostgreSQL 16 + Redis 7）

## 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 生成 SESSION_SECRET（至少 32 位随机串）：
#   openssl rand -base64 32

# 3. 启动基础设施（仅 postgres 和 redis）
docker compose -f docker/docker-compose.yml up -d postgres redis

# 4. 启动全部服务（自动先跑迁移）
pnpm dev
```

`pnpm dev` 内部执行 `turbo migrate && turbo dev`。开发环境（NODE_ENV != production）下 `/docs` 提供 OpenAPI 文档：

- Storefront: http://localhost:3000/docs
- Admin: http://localhost:3001/docs

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 跑迁移 + 启动全部服务（watch 模式） |
| `pnpm build` | 全量构建 |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm lint` | Biome 检查 |
| `pnpm format` | Biome 自动修复 |
| `pnpm check` | Biome CI 模式（零修改） |
| `pnpm lint:boundaries` | 分层依赖校验（提交前自动执行） |
| `pnpm clean` | 清理 dist / .turbo |

## 数据库迁移

改动表结构的流程：

1. 修改 `packages/database/src/schema/*.ts`（枚举/外键变更见历史迁移 SQL 的模式）
2. 生成迁移：
   ```bash
   pnpm --filter @epinfresh/database db:generate
   ```
3. 检查生成的 SQL 并**提交到 `packages/database/src/migrations/`**

运行迁移：

```bash
pnpm --filter @epinfresh/database db:migrate     # drizzle-kit migrate
pnpm --filter @epinfresh/database migrate        # 自研迁移入口（CI/compose 使用）
```

CI 中每次推送会在真实 Postgres 服务上执行迁移，确保迁移文件可重放。

## 架构约定

### 领域（domains/*）

每个领域由三个文件组成，职责严格分离：

- `index.ts` — 对外出口：导出 service 函数和类型（不暴露内部实现）
- `service.ts` — 纯业务逻辑，**不 import Elysia / session / http**；依赖通过最后一个参数传入（`client: DbClient`）；失败返回 `err('ERROR_CODE')`，成功返回 `ok(data)`
- `model.ts` — TypeBox schema，优先从 DB 派生：`table.insert.X` / `table.select.X`，字段约束在 `packages/database/src/model.ts` 集中覆盖

领域之间的调用只允许 domain-flow → domain-core（如 `checkout` 调 `reduceProductStock`），core 之间禁止互调。

### 控制器（apps/*/src/routes/*.ts）

- Elysia 路由实例，职责：HTTP 协议映射 + 校验 + 错误码转状态码
- 用 `result.match()` 消费 neverthrow Result，`switch (code)` 映射为 `status(4xx, { error: code, message })`
- 响应 schema 必须显式声明（`response: { 200: ..., 404: ErrorResponse }`）
- 认证用 `isAuth` / `isAdmin` macro（`packages/session` 提供）

### 装配与 DI

- 每个 app 的 `plugins.ts` 负责基础设施接线（db/redis/queue/session），通过 Elysia `.use()` / `.decorate()` / `.derive()` 注入，**不建全局单例**
- env 用 `parseEnv(TypeBox schema)` 启动时校验，**fail-fast**；生产环境有额外守卫（如 CORS 不允许 `*`）
- `buildApp()` 与 `import.meta.main` 分离，便于测试和复用

### 队列与 Job

- 队列名、job 名、payload 类型定义在**领域内的 `jobs.ts`**（纯契约，零依赖）
- handler 只消费**纯数据**（`(data, logger)`），不接触 BullMQ 类型；BullMQ 适配只在 `createWorker` / `createDispatcher` 调用点出现
- 消费者在 `apps/worker/src/registry.ts` 统一注册；队列生产方在 app 侧通过 `createQueue` 使用（默认 3 次重试 + 指数退避）

### 技术债标注

`ponytail:` 开头的注释表示已知技术债，包含背景和解决方向。新债请沿用该标记。

## 提交规范

采用 Conventional Commits，由 commitlint + lefthook 强制：

- `feat:` / `fix:` / `refactor:` / `docs:` / `ci:` / `chore:` 等类型
- pre-commit 自动执行：Biome 修复 + `pnpm lint:boundaries`
- commit-msg 自动校验提交信息格式

## CI / Docker

GitHub Actions（`.github/workflows/ci.yml`）在 push/PR 时执行：Biome → typecheck → build → commitlint → 真实 Postgres 上跑迁移。

- 镜像构建：根目录 `Dockerfile`，用 `--build-arg APP=<app 名>` 选择目标服务
- 一键起全套：`docker compose -f docker/docker-compose.yml up -d`（含 migrate 前置服务，迁移成功后才启动 API）
