# 贡献指南（CONTRIBUTING）

本规范适用于 **epinfresh** monorepo 的所有贡献者（含人类与 AI agent）。提交代码前请通读本文档；其中标注「MUST / 必须」「SHOULD / 应当」「MAY / 可以」遵循 RFC 2119 语义。

> 另见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)（技术栈与阶段规划）、[AGENTS.md](./AGENTS.md)（AI agent 速查硬约束）。

---

## 1. 项目概览与技术栈

epinfresh 是一个电商后端 monorepo，以领域驱动（DDD）方式组织，C 端与 B 端 API 分进程部署。

| 层面 | 选型 |
|------|------|
| 包管理 | pnpm workspaces |
| 任务编排 | Turborepo |
| 运行时 | Bun（>=1.2） |
| Node（仅 CI/工具） | >=22 |
| 后端框架 | ElysiaJS |
| 认证 | Session（Redis 存储，cookie 携带 session_id） |
| ORM | Drizzle ORM |
| 数据库 | PostgreSQL |
| 缓存/队列 | Redis（ioredis） |
| 代码风格 | Biome（format + lint） |
| 错误处理 | neverthrow `Result` |
| 校验 | TypeBox（经 Elysia `t`） |
| 日志 | pino（结构化） |
| Git 钩子 | lefthook |
| 提交规范 | Conventional Commits（commitlint） |
| CI | GitHub Actions |

---

## 2. 环境准备

### 2.1 前置依赖

- [Bun](https://bun.sh) >= 1.2
- [pnpm](https://pnpm.io) >= 10（仓库已通过根 `package.json` 的 `packageManager: "pnpm@10.7.0"` 锁定，启用 corepack 即可自动对齐）
- Docker（用于本地 PostgreSQL / Redis）
- Node >= 22（仅 CI 与部分工具链需要）

### 2.2 首次启动

```bash
pnpm install                          # 安装依赖（含 lefthook 自动 install）
cp .env.example .env                  # 复制环境变量模板
docker compose -f docker/docker-compose.yml up -d   # 启动 PostgreSQL + Redis
pnpm dev                              # 跑迁移并启动两个 API 服务
```

`pnpm dev` 等价于 `turbo migrate && turbo dev`，会先执行数据库迁移再启动 `api-www`(:3000) 与 `api-admin`(:3001)。

### 2.3 访问入口

| 服务 | 地址 |
|------|------|
| C 端 API | http://localhost:3000 |
| B 端 API | http://localhost:3001 |
| OpenAPI 文档（C 端） | http://localhost:3000/docs |
| OpenAPI 文档（B 端） | http://localhost:3001/docs |
| 健康检查 | `GET /health`（两端各自提供） |

---

## 3. 常用脚本

根目录脚本（通过 Turborepo 编排到各子包）：

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 跑迁移 + 启动所有服务（watch） |
| `pnpm build` | 构建所有子包（`tsc` 产物到 `dist/`） |
| `pnpm typecheck` | 全量类型检查（`tsc --noEmit`） |
| `pnpm lint` | Biome 检查（只读，`biome check .`） |
| `pnpm format` | Biome 检查并自动修复（`biome check --write .`） |
| `pnpm check` | Biome CI 模式（`biome ci .`，用于 CI，不写入） |

数据库相关（在 `packages/database` 下）：

| 命令 | 作用 |
|------|------|
| `pnpm --filter @epinfresh/database db:generate` | 根据 schema 变更生成迁移 SQL |
| `pnpm --filter @epinfresh/database db:migrate` | 通过 drizzle-kit 执行迁移 |
| `pnpm --filter @epinfresh/database migrate` | 通过应用层 `migrate.ts` 执行迁移（dev/启动时用） |

> **MUST**：改动 `packages/database/src/schema/**` 后，必须先 `db:generate` 生成迁移，再 `db:migrate` 应用，并提交生成的迁移文件（`*.sql` + `meta/*`）。

---

## 4. 仓库结构与分层依赖规则

### 4.1 目录结构

```
epinfresh/
├── config/tsconfig/          # @epinfresh/tsconfig — 共享 tsconfig 基座
├── packages/
│   ├── shared/               # @epinfresh/shared — 跨层契约：类型、常量、env、日志、通用 model
│   └── database/             # @epinfresh/database — Drizzle schema、db 连接、迁移、TypeBox table
├── domains/
│   ├── session/              # @epinfresh/session — 基础设施域：Redis、会话、限流
│   ├── user/                 # @epinfresh/user — 用户/认证业务域
│   └── product/              # @epinfresh/product — 商品/分类业务域
├── apps/
│   ├── api-www/              # C 端 API（端口 3000）
│   └── api-admin/            # B 端 API（端口 3001）
├── docker/docker-compose.yml # 本地 PostgreSQL + Redis
├── turbo.json
├── biome.json
├── lefthook.yml
└── commitlint.config.js
```

### 4.2 分层与依赖方向（MUST 严格遵守）

```
                    @epinfresh/shared          （叶节点，无内部依赖）
                       ▲        ▲
            ┌──────────┘        └──────────┐
   @epinfresh/database              @epinfresh/session     （兄弟基础设施，互不依赖）
            ▲                                ▲
            └──────────┐        ┌────────────┘
                       ▼        ▼
              @epinfresh/user  @epinfresh/product          （业务域）
                       ▲            ▲
                       └─────┬──────┘
                             ▼
                  apps/api-www, apps/api-admin              （应用装配层）
```

硬规则：

- **MUST**：依赖只能自上而下指向更底层。`shared` 是唯一叶节点。
- **MUST**：`@epinfresh/session` 与 `@epinfresh/database` 是**兄弟基础设施包**，**禁止互相依赖**。`session` 必须保持 DB-free（仅依赖 Redis），`database` 不依赖 Redis。
- **MUST**：**业务域之间禁止互相依赖**（`user` 不能 import `product`，反之亦然）。业务域只能依赖 `shared` / `database` / `session`。域的组合由上层 `apps/*` 通过 `.use()` 装配完成。
- **MUST**：业务域依赖 `session` 仅用于鉴权/会话/限流能力（如 `user → session`）；不涉及认证的业务域（如 `product`）不应依赖 `session`。
- **SHOULD**：`apps/*` 只做装配（装配顺序见 §9），不写业务逻辑。

### 4.3 enum 契约归属（MUST）

`USER_ROLE`、`PRODUCT_STATUS` 等**跨层共享的业务枚举**，其**值与类型定义在 `@epinfresh/shared`**（`src/constants.ts`），作为领域契约层。

- `@epinfresh/database` 的 `pgEnum` 从 `shared` 导入这些常量派生：`pgEnum('user_role', USER_ROLE)`。
- `@epinfresh/session` 等 DB-free 包可直接从 `shared` 消费（运行时值 + 类型），无需引入 `database`。
- 类型一律从常量推导：`type UserRole = (typeof USER_ROLE)[number]`，**禁止**另起 `interface`/`type` 重复声明。

> 理由：`user_role` 同时被 `database`（pgEnum）与 `session`（SessionSchema 校验）消费，二者是兄弟，其唯一共同上游是 `shared`。详见 [AGENTS.md](./AGENTS.md)「依赖拓扑」。

---

## 5. 新建 domain 包 Checklist

### 5.1 标准业务域五件套

每个业务域 MUST 采用如下结构（`domains/<name>/`）：

```
domains/<name>/
├── package.json
├── tsconfig.json
└── src/
    ├── model.ts      # Elysia model（TypeBox schema 注册 + InferModelsMap）
    ├── service.ts    # 业务逻辑（静态类 + Result）
    ├── www.ts        # C 端路由插件（userWWWPlugin）
    ├── admin.ts      # B 端路由插件（userAdminPlugin）
    └── index.ts      # barrel 导出
```

### 5.2 `package.json` 模板

```jsonc
{
  "name": "@epinfresh/<name>",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@epinfresh/database": "workspace:*",
    "@epinfresh/shared": "workspace:*",
    "drizzle-orm": "^0.40.0",
    "elysia": "^1.2.0",
    "neverthrow": "^8.2.0"
  }
}
```

- `main`/`types` 直接指向 `src/index.ts`（源码即入口，内部包不经 `dist` 发布）。
- 仅当域需要鉴权时才加 `"@epinfresh/session": "workspace:*"`。
- 开发依赖（biome/turbo/typescript）集中在根 `package.json`，子包**不应**重复声明。

### 5.3 `tsconfig.json` 模板

```jsonc
{
  "extends": "../../config/tsconfig/base.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src"]
}
```

### 5.4 例外：基础设施域

`@epinfresh/session` 是**基础设施域**，**不适用**五件套。它按职责拆分为 `sessionPlugin.ts` / `redis.ts` / `rateLimit.ts` / `index.ts`。新增基础设施能力时 SHOULD 在该包内扩展，而非新建业务域结构。

### 5.5 接入 app

新域完成后，在 `apps/api-www/src/index.ts` 和/或 `apps/api-admin/src/index.ts` 的业务插件区 `.use(<name>WWWPlugin)` / `.use(<name>AdminPlugin)` 装配，并在 app 的 `dependencies` 加 `"@epinfresh/<name>": "workspace:*"`。

---

## 6. Elysia 编码规范

遵循 [Elysia 官方 MVC 建议](https://elysiajs.com/patterns/mvc) 与本仓库既有约定。

### 6.1 方法链（MUST）

Elysia 类型依赖链式调用推断。**禁止**把实例赋值后再单独调用方法（会丢类型）。

```ts
// ✅ do
new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
  .use(userModel)
  .get('/me', ({ session }) => { ... })

// ❌ don't
const app = new Elysia({ prefix: '/api/v1/auth' })
app.use(userModel)   // 丢失类型推断
```

### 6.2 插件必须命名（MUST）

所有可被 `.use()` 复用的 Elysia 实例 MUST 传 `{ name: '...' }`，以启用去重（否则每次 `.use` 重新执行）。

```ts
new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
new Elysia({ name: 'common-model' })
new Elysia({ name: 'request-logger' })
```

### 6.3 模型按名引用 + 命名空间前缀（MUST）

- 用 `.model({ Name: schema })` 注册，路由里**按字符串名引用**（`body: 'RegisterInput'`），而非传 schema 对象。
- 业务域 model **MUST** 用 `.prefix('model', '<Domain>')` 加命名空间，避免跨域同名冲突（如 `User.RegisterInput`、`Product.ProductResponse`）。
- 跨域共享模型（`ErrorResponse`、`PaginationQuery`）由 app 根的 `commonModel`（来自 `@epinfresh/shared`）统一注册，**禁止**在业务域内重复注册 `ErrorResponse`。

```ts
export const userModel = new Elysia()
  .model({
    RegisterInput: t.Object({ ... }),
    UserResponse: UserResponseSchema,
  })
  .prefix('model', 'User')   // 引用名变为 'User.RegisterInput' 等
```

### 6.4 鉴权用 macro / 全局 guard（MUST）

- 路由级鉴权用 `createSessionPlugin()` 暴露的 macro 选项：`{ isAuth: true }` / `{ isAdmin: true }`。**禁止**手写 `as Session` 强转。
- B 端 app 全局守护用 `.onBeforeHandle` 在业务插件之前注册（见 §11），不逐路由重复。
- 全局生命周期（日志、错误日志）用 `as: 'global'`；带类型的 derive 用 `as: 'scoped'`。

### 6.5 handler 内联解构（MUST）

handler 必须是内联函数，从 context 解构所需字段传给 Service。**禁止**把整个 `Context` 传给 Service/Controller。

```ts
// ✅ do
.get('/me', ({ session }) => UserService.getById(session.userId), { ... })

// ❌ don't
.get('/me', (ctx) => UserService.getById(ctx.session.userId))
```

### 6.6 返回 `status()` 而非 throw（MUST）

- Service 返回 `Result`（`ok`/`err`），不 throw。
- Controller 用 `.match()` 把 `err` 映射为 `status(4xx, { error, message })`。
- 500（服务错误）与 400（校验错误）遵循 Elysia 默认行为，**不**额外格式化。

### 6.7 装配顺序（apps，MUST）

```
requestLogger → cors → openapi(/docs) → commonModel → /health
  → [createSessionPlugin + onBeforeHandle 守卫，仅 admin]
  → 业务域插件
  → listen(port)
```

`/health` 与 `/docs` MUST 在鉴权守卫之前注册，以保证未认证可访问。

### 6.8 优雅关闭（MUST）

app MUST 监听 `SIGTERM`/`SIGINT`，按序 `app.stop() → closeDb() → closeRedis() → process.exit(0)`，避免连接泄漏。

### 6.9 导出类型供 Eden（SHOULD）

app 末尾 `export type App = typeof app` 与 `export type <Name>Models = InferModelsMap<typeof app>`，为后续 Eden Treaty 端到端类型对接预留。

---

## 7. Model / Service / Controller 分层约定

### 7.1 Model（`model.ts`）

- 用 TypeBox（经 `elysia` 的 `t`）定义输入/输出 schema。
- **MUST**：从数据库 schema 派生，避免手写重复字段。用 `@epinfresh/database` 的 `table.select.<table>` / `table.insert.<table>` / `table.update.<table>`（由 `drizzle-typebox` 生成）配合 `t.Omit` / `t.Intersect` / `t.Partial` 组合。
- **MUST**：导出 `export type <Name>Model = InferModelsMap<typeof <name>Model>`。
- 分页响应用 `PaginatedResponse(ItemSchema)`，分页查询用 `PaginationQuery`（均来自 `@epinfresh/shared`）。

```ts
const UserResponseSchema = t.Omit(table.select.user, ['passwordHash'])

export const userModel = new Elysia().model({
  RegisterInput: t.Intersect([
    t.Omit(table.insert.user, ['id', 'passwordHash', 'role', 'avatar', 'createdAt', 'updatedAt']),
    t.Object({ name: t.String({ minLength: 1, maxLength: 255 }), password: t.String({ minLength: 8 }) }),
  ]),
  UserResponse: UserResponseSchema,
  UserListResponse: PaginatedResponse(UserResponseSchema),
  UserListQuery: PaginationQuery,
}).prefix('model', 'User')

export type UserModel = InferModelsMap<typeof userModel>
```

### 7.2 Service（`service.ts`）

- **MUST**：静态类（`static` 方法），不实例化、不持有状态。
- **MUST**：不依赖 Elysia `Context`，入参为纯数据（model 派生类型或原始值）。
- **MUST**：业务错误返回 `err('CODE')`（字符串错误码，`SCREAMING_SNAKE_CASE`），成功返回 `ok(value)`；不 `throw`。
- **MUST**：脱敏字段（如 `passwordHash`）在返回前解构剔除。
- **SHOULD**：数据库事务用 `db.transaction(async (tx) => { ... })`。
- **SHOULD**：防用户枚举的时序攻击场景（如登录），对「用户不存在」也跑一次等价的 dummy 哈希校验（见 `UserService.login`）。

```ts
export class UserService {
  static async getById(id: string): Promise<Result<SafeUser, 'USER_NOT_FOUND'>> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
    if (!user) return err('USER_NOT_FOUND')
    const { passwordHash: _, ...safeUser } = user
    return ok(safeUser)
  }
}
```

### 7.3 Controller（`www.ts` / `admin.ts`）

- 一个 Elysia 实例 = 一个 Controller。
- **MUST**：`new Elysia({ name: '<domain>-www'|'<domain>-admin', prefix: '/api/v1' | '/api/v1/admin' })`。
- **MUST**：链式 `.use(<name>Model).use(commonModel)`。
- **MUST**：每个路由声明 `response: { <status>: '<ModelName>' }`，`detail: { tags: [...] }`。
- **MUST**：`params` 用 `t.Object({ id: t.String({ format: 'uuid' }) })` 约束。
- handler 内联解构 → 调 Service → `.match()` 映射 Result。

```ts
export const userWWWPlugin = new Elysia({ name: 'user-www', prefix: '/api/v1/auth' })
  .use(userModel)
  .use(commonModel)
  .use(createSessionPlugin())
  .post('/register', ({ body }) => UserService.register(body), {
    body: 'RegisterInput',
    response: { 200: 'UserResponse' },
    detail: { tags: ['Auth'] },
  })
```

---

## 8. 错误处理与 HTTP 状态契约

### 8.1 错误响应体（MUST）

所有业务错误响应体统一为 `ErrorResponse = { error: string; message: string }`：

```json
{ "error": "USER_NOT_FOUND", "message": "User not found" }
```

- `error`：大写蛇形错误码，与 Service 返回的 `err('CODE')` 一致。
- `message`：人类可读描述。

### 8.2 状态码语义（MUST）

| 状态 | 语义 | 例 |
|------|------|----|
| 200 | 成功（GET/PUT/PATCH） | 获取/更新资源 |
| 201 | 创建成功（POST） | 新建资源 |
| 204 | 无内容（DELETE） | 删除成功 |
| 400 | 校验错误 | Elysia 默认（不另格式化） |
| 401 | 未认证 | `isAuth` 守卫、`UNAUTHORIZED` |
| 403 | 无权限 | `isAdmin` 守卫、`FORBIDDEN` |
| 404 | 资源不存在 | `USER_NOT_FOUND`、`PRODUCT_NOT_FOUND` |
| 409 | 冲突 | `CATEGORY_HAS_PRODUCTS` |
| 429 | 限流 | `RATE_LIMITED` |
| 500 | 服务错误 | Elysia 默认（不另格式化） |

### 8.3 路由声明响应（MUST）

每个业务路由 MUST 在 `response` 中声明所有可能的非 2xx 业务错误码对应的状态，以便 OpenAPI 透传与 Eden 类型推断：

```ts
response: {
  200: 'UserResponse',
  401: 'ErrorResponse',
  404: 'ErrorResponse',
}
```

### 8.4 Result → HTTP 映射模式（MUST）

```ts
const result = await UserService.getById(params.id)
return result.match(
  (user) => user,
  (code) => status(404, { error: code, message: 'User not found' }),
)
```

多错误码用 `switch`：

```ts
(code) => {
  switch (code) {
    case 'CATEGORY_NOT_FOUND': return status(404, { error: code, message: 'Category not found' })
    case 'CATEGORY_HAS_PRODUCTS': return status(409, { error: code, message: 'Category still has products' })
  }
}
```

---

## 9. 路由与 OpenAPI 约定

### 9.1 路由前缀（MUST）

| 端 | 前缀 |
|----|------|
| C 端业务 | `/api/v1` |
| B 端业务 | `/api/v1/admin` |
| C 端认证 | `/api/v1/auth` |
| 根路由 | `/health`、`/docs`（无前缀） |

**MUST**：B 端域插件用 `prefix: '/api/v1/admin'` + 资源路径（`/products`、`/products/:id`），**禁止**把资源名塞进 prefix 再用 `.get('/')`（会产生尾斜杠）。

### 9.2 `detail.tags` 命名（MUST）

| 场景 | tag |
|------|-----|
| C 端认证 | `Auth` |
| C 端商品 | `Products` |
| C 端分类 | `Categories` |
| B 端商品 | `Admin/Products` |
| B 端分类 | `Admin/Categories` |

新增域遵循 `<Resource>` 与 `Admin/<Resource>` 的成对约定。

### 9.3 OpenAPI 文档（MUST）

两个 app MUST 挂载 `@elysiajs/openapi` 于 `/docs`，`documentation.info.title` 区分（`Epinfresh WWW API` / `Epinfresh Admin API`）。所有路由 MUST 带 `detail.tags`。

### 9.4 健康检查（MUST）

`GET /health` 返回 `{ status: 'ok', service: 'www' | 'admin' }`，不鉴权。

---

## 10. 数据库与迁移约定

### 10.1 schema 组织（`packages/database/src/schema/`）

- 每张表一个文件（`users.ts`、`products.ts`、`product-skus.ts`、`categories.ts`），`index.ts` barrel 导出，`relations.ts` 集中定义关系。
- **MUST**：主键用 `uuid('id').defaultRandom().primaryKey()`。
- **MUST**：时间戳用 `timestamp('created_at', { withTimezone: true }).defaultNow().notNull()`；`updated_at` 加 `.$onUpdate(() => new Date())`。
- **MUST**：enum 用 `pgEnum('<name>', <SHARED_CONST>)`，值常量来自 `@epinfresh/shared`（见 §4.3）。
- **MUST**：外键显式声明 `references` + `onDelete` 策略（`cascade` / `set null` 视语义）。
- **SHOULD**：为高频查询列建索引（`index('table_col_idx').on(t.col)`）。

### 10.2 金额（MUST）

金额用 `decimal('price', { precision: 10, scale: 2 })`，Drizzle 以**字符串**形式返回。写入时 `String(number)`，业务层做数值校验（`t.Number({ minimum: 0 })`）。**禁止**用 float/double 存金额。

### 10.3 TypeBox 派生（`packages/database/src/model.ts`）

用 `drizzle-typebox` 的 `createSelectSchema` / `createInsertSchema` / `createUpdateSchema` 生成 `table.select` / `table.insert` / `table.update`，供业务域 model 复用。jsonb 字段用 `Type.Array(Type.String())` / `Type.Record(...)` 显式定型。

### 10.4 迁移流程（MUST）

1. 改 `src/schema/**.ts`
2. `pnpm --filter @epinfresh/database db:generate` 生成迁移（`src/migrations/000X_*.sql` + `meta/*`）
3. `pnpm --filter @epinfresh/database db:migrate` 应用到本地 DB
4. 提交 schema 改动 + 生成的迁移文件
5. **MUST**：`src/migrations/meta/*` 由 drizzle-kit 生成，**禁止手工编辑**（已被 biome ignore）。
6. **MUST**：迁移文件一旦提交，**禁止**修改历史迁移，只能新增。

### 10.5 启动时迁移（MUST）

迁移由 `turbo migrate` 在 `pnpm dev` 前置执行（`packages/database/src/migrate.ts`），**禁止**在 app 启动路径内调用 `runMigrations()`（避免多进程并发迁移）。

---

## 11. 鉴权与会话

### 11.1 架构（MUST）

- 会话数据（`{ userId, role }`）以 JSON 存于 Redis，key 为 `session:<uuid>`，TTL 86400s。
- `session_id` 通过 cookie 携带，cookie 属性：`httpOnly: true`、`sameSite: 'strict'`、`path: '/'`、`secure: production`、`maxAge: SESSION_TTL_SECONDS`。
- 鉴权能力封装在 `@epinfresh/session`，业务域通过 `createSessionPlugin()` 接入，经 derive 自动流入 `session` / `sessionStore` 上下文，经 `isAuth` / `isAdmin` macro 守卫路由。

### 11.2 接入规则

- C 端路由按需在路由选项加 `{ isAuth: true }`（如 `/me`）；公开路由（`/login`、`/register`）不加。
- B 端 app 在装配时 `.use(createSessionPlugin()).onBeforeHandle(...)` 做全局 admin 守卫（见 §6.7），业务路由无需重复声明。
- **MUST**：`session` 上下文类型由 derive 推断，**禁止** `as Session` 强转。

### 11.3 限流（MUST）

- 用 `@epinfresh/session` 的 `authRateLimit({ prefix, limit, window })`，基于 Redis store。
- 敏感路由（如 `/login`）SHOULD 配更严限流（如 `limit: 10, window: '60s'`）。
- 限流触发返回 `429 { error: 'RATE_LIMITED', message: 'Too many requests' }`。

### 11.4 SESSION_SECRET（注意事项）

`SESSION_SECRET` 当前在 env schema 强制 `minLength: 32` 但尚未被消费（会话以 UUID 为 key 存 Redis，未做签名）。新增需要签名/加密的场景时 SHOULD 启用该密钥；在此之前**禁止**从 env schema 移除该约束（保留为前置校验）。

---

## 12. 环境变量规范

### 12.1 单一事实源（MUST）

- `.env.example` 是环境变量的**唯一文档化事实源**。新增/改名环境变量时 MUST 同步更新 `.env.example` 并加注释。
- 本地 `.env` 从 `.env.example` 拷贝；`.env` 被 gitignore，**禁止**提交。
- **MUST**：`.env` 与 `.env.example` 的字段集合保持一致（可有默认值的字段也应在 `.env.example` 中列出）。

### 12.2 校验（MUST）

- 所有环境变量 MUST 在 `packages/shared/src/env.ts` 用 TypeBox schema 声明（`baseEnvSchema` + app 专属 schema）。
- app 启动时调用 `loadEnv(<schema>)` 校验：缺失/非法时抛 `[ENV] missing or invalid: ...`，**禁止**直接 `process.env.X` 裸读。
- `loadEnv` 负责 `Value.Default` 填充默认值、`Value.Errors` 收集错误、`Value.Cast`/`Value.Decode` 强转与解码。

### 12.3 加载方式

- dev：`bun --env-file=../../.env src/index.ts`（由各 app `package.json` 的 `dev` 脚本指定）。
- 生产：依赖进程环境变量（`start` 脚本不带 `--env-file`）。

### 12.4 现有变量

见 `.env.example`。关键项：`DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET`（>=32 字符）、`NODE_ENV`、`LOG_LEVEL`、`CORS_ORIGIN`（支持 `*` / 单源 / 逗号分隔白名单）、`WWW_PORT`、`ADMIN_PORT`。

---

## 13. 日志规范

### 13.1 结构化日志（MUST）

用 `@epinfresh/shared` 的 `logger`（pino 实例），**禁止** `console.log` 用于业务日志（仅启动横幅/关闭错误可用 `console.log`/`console.error`）。

```ts
import { logger } from '@epinfresh/shared'
logger.info({ requestId, userId }, 'user login')
```

### 13.2 请求日志（MUST）

两个 app MUST 在装配链最前 `.use(requestLogger())`。它：

- `onRequest`：生成 `requestId`（UUID），写入响应头 `x-request-id`，记录入站日志。
- `onAfterResponse`（global）：记录出站日志（method/path/status/durationMs）。
- `onError`（global）：记录错误日志（含 stack）。

### 13.3 脱敏（MUST）

`logger` 已配置 pino `redact`：`req.headers.authorization`、`req.headers.cookie`、`headers.authorization`、`headers.cookie`。**禁止**把 cookie/token 明文打进日志业务字段。

### 13.4 级别

由 `LOG_LEVEL` 控制（`debug|info|warn|error|silent`，默认 `info`）。生产 SHOULD 为 `info` 或 `warn`。

---

## 14. 代码风格（Biome）

### 14.1 配置

统一由根 `biome.json` 治理：

- 缩进 2 空格，行宽 100
- 单引号，**无分号**（`semicolons: 'asNeeded'`）
- `organizeImports` 开启
- linter `recommended` 规则全开

### 14.2 命令

- 本地自检：`pnpm lint`
- 自动修复：`pnpm format`
- CI：`pnpm check`（`biome ci`，不写入，失败即阻断）

### 14.3 未用代码（MUST）

**禁止**提交未使用的 import / 变量。提交前跑 `pnpm format` 自动清理可修复项；其余手动清除。

### 14.4 忽略项

`biome.json` 已 ignore：`node_modules`、`dist`、`.turbo`、`biome-logs`、`.agents`、`.git`、`packages/database/src/migrations/meta`。**禁止**为业务源码新增 ignore。

---

## 15. Git 工作流

### 15.1 分支

- `main`：受保护，始终可部署。PR 合并即部署候选。
- 特性分支命名：`feat/<scope>-<short>`、`fix/<scope>-<short>`、`refactor/<scope>-<short>`、`chore/<scope>-<short>`。

### 15.2 提交信息（MUST）

遵循 [Conventional Commits](https://www.conventionalcommits.org/)，由 commitlint 强制（`@commitlint/config-conventional`）：

```
<type>(<scope>): <subject>

type: feat | fix | refactor | chore | docs | style | test | perf | ci | build
```

示例：`feat(user): add password reset`、`fix(product): handle missing sku`、`refactor(session): drop unused redis imports`。

### 15.3 Pre-commit 钩子（lefthook）

`lefthook.yml` 配置：

- `pre-commit`：对暂存的 `*.{js,ts,jsx,tsx,...}` 跑 `biome check --write`，自动暂存修复（`stage_fixed: true`）。
- `commit-msg`：跑 `commitlint --edit`。

`pnpm install` 会触发 `prepare` 脚本自动 `lefthook install`。

### 15.4 PR 流程（SHOULD）

1. 从 `main` 切特性分支
2. 确保 `pnpm typecheck && pnpm lint && pnpm build` 本地通过
3. 提交 PR，描述改动与验证方式
4. CI 全绿后方可合并

---

## 16. CI 流程

`.github/workflows/ci.yml` 在 `push` 到 `main` 与所有 PR 时触发，执行：

1. `pnpm install --frozen-lockfile`
2. `pnpm check`（Biome CI：格式 + lint）
3. `pnpm typecheck`（全量 `tsc --noEmit`）
4. `pnpm build`（全量 `tsc` 产物）

**MUST**：PR 合并前 CI 必须全绿。本地提交前 SHOULD 跑 `pnpm typecheck && pnpm lint` 自检。

CI 环境：ubuntu-latest + Node 22 + Bun latest + pnpm 10，Turbo 缓存键为 `turbo-<os>-<hash(pnpm-lock.yaml)>`。

---

## 附录：常见反模式清单

| ❌ 反模式 | ✅ 正解 |
|----------|--------|
| `as Session` 强转获取会话 | `createSessionPlugin()` derive 自动流入 |
| `throw new Error()` 处理业务错误 | Service 返回 `err('CODE')`，路由 `.match()` |
| 路由里传整个 `Context` 给 Service | 内联解构，只传所需字段 |
| `new Elysia()` 不命名就被 `.use` | 传 `{ name: '...' }` 启用去重 |
| model 传 schema 对象给路由 | 注册后按字符串名引用 |
| 业务域之间互相 import | 域组合由 app 装配 |
| `session` 依赖 `database` | 两者兄弟，共享枚举走 `shared` |
| 手写与 DB schema 重复的 model 字段 | 从 `table.select/insert/update` 派生 |
| `console.log` 业务日志 | `logger.info(...)` 结构化 |
| 裸读 `process.env.X` | `loadEnv(schema)` 校验 |
| 修改历史迁移文件 | 只能新增迁移 |
| `pgEnum` 自维护值常量 | 值常量来自 `@epinfresh/shared` |
| app 启动路径内跑迁移 | 由 `turbo migrate` 前置 |
| B 端 prefix 塞资源名 + `.get('/')` | prefix 到 `/admin`，资源名在路径 |
