# CONTRIBUTE.md

面向新开发者的上手文档：分层 → 开发模式 → 动手写。所有代码都应遵循下文模式；
如发现文档与代码不一致，以代码为准并修正本文档。

## 技术栈

pnpm + Turborepo Monorepo、Bun 运行时

- Web：ElysiaJS（类型安全、插件化）
- ORM：Drizzle + postgres.js；DB 与 API 契约单一来源（TypeBox / drizzle-typebox）
- 队列：BullMQ（Redis）；会话：Redis 会话 + 签名 Cookie；错误：neverthrow Result
- 工具：ESLint（含 eslint-plugin-boundaries 分层校验）、Prettier、lefthook、commitlint

## 分层架构

目录即分层，依赖方向由 eslint-plugin-boundaries 编译期强制（单向无环）：

```
apps/       presentation   可依赖一切（薄壳：装配 + HTTP 映射，不含业务逻辑）
usecases/*  编排层         可依赖 persistence/shared/domains（跨域用例）
domains/*   entity 域      可依赖 persistence/shared（纯业务逻辑）
packages/   shared / persistence / infrastructure（纯工具、DB、基础设施）
```

- domain 之间禁止互调；只有 usecases 能编排多个 domain
- queue/http/session/redis 全部归 infrastructure，领域层编译期封死
- 新增/改名 domain 或 usecase 无需改 eslint 配置（pattern 是目录通配）

## 快速上手

```bash
pnpm install
cp .env.example .env        # SESSION_SECRET 生成：openssl rand -base64 32
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm dev                    # 自动迁移 + 全部服务 watch
```

- 接口文档：http://localhost:3000/docs（storefront）、http://localhost:3001/docs（admin）
- `pnpm test` 需要本地 postgres + redis；测试库/Redis 配置在 `.env` 的 `TESTING_*`
- 常用命令：`typecheck` / `lint` / `format` / `check` / `build` / `clean` / `test`

## 开发模式

### 1. 新增领域（domains/*）

固定三文件结构，职责严格分离：

| 文件       | 职责                       | 约束                                                                                                   |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| model.ts   | TypeBox schema，从 DB 派生 | 字段约束集中在 packages/database/src/model.ts                                                          |
| service.ts | 纯业务函数                 | 不 import Elysia/session/http；依赖以参数注入（client: DbClient）；失败 `err('CODE')`，成功 `ok(data)` |
| index.ts   | 对外出口，只导出函数与类型 | 不暴露内部实现                                                                                         |

**错误码约定**：域层用大写错误码字符串 `err('CODE')`。控制器必须穷举映射（见 §3），
因此**新增错误码 = 编译错误**，强制在任何入口处补映射，杜绝静默漏处理。

### 2. 新增用例（usecases/*）

跨域编排放这里，与 domain 同样的三文件结构。需要原子性时用
`client.transaction` 包住多个 domain 调用；幂等需求在事务内写唯一约束表实现
（冲突时回滚整个事务，不静默跳过）。

### 3. 新增路由（apps/*/src/routes/）

控制器 = Elysia 实例，职责：HTTP 协议映射 + 校验 + 错误码→状态码。
每个路由文件导出工厂 `createXxxRoutes(plugins)`，接收插件实例按需 `.use()`：

```ts
export function createOrderRoutes(plugins: StorefrontPlugins) {
  return new Elysia({ name: 'order-storefront' })
    .use(plugins.dbPlugin)
    .use(plugins.sessionPlugin)
    .post(
      '/orders',
      async ({ body, session, db }) => {
        const result = await checkoutWorkflow({ ...body, userId: session.userId }, db)
        return result.match(
          (order) => status(201, order),
          (code) => {
            switch (code) {
              case 'SKU_NOT_FOUND':
                return status(404, { error: code, message: 'SKU not found' })
              case 'INSUFFICIENT_STOCK':
                return status(409, { error: code, message: 'Insufficient stock' })
              default:
                return assertNever(code) // shared 提供，编译期强制穷举
            }
          },
        )
      },
      {
        isAuth: true,
        body: CreateOrderInputSchema,
        response: { 200: OrderModel.OrderResponseSchema, 404: ErrorResponse },
        detail: { tags: ['Orders'] },
      },
    )
}
```

规范：

- 用 `result.match()` 消费 Result；错误分支 switch 穷举 + `default: assertNever(code)`
- 响应 schema 必须显式声明（`response: {...}`）；Elysia normalize 自动剥离未声明字段，
  敏感字段只需在 schema 中 omit，service 层不手工剔除
- 认证用 `isAuth` / `isAdmin` macro（packages/session 提供）
- 前置守卫（不消费 ok 值的 isErr 检查）可保留 `if (x.isErr()) return status(...)` 形式

### 4. 装配与 DI

依赖单向流入，测试可注入：

```
createEnv() → createDeps(env) → buildApp(options) → createPlugins(options) → routes
```

- app 不读 `process.env`：env.ts 只有工厂，无模块级单例；plugins 无全局常量
- `buildApp(options)` 与 `import.meta.main` 分离：生产入口构造 deps，
  测试直接注入 test 依赖（db/redis/secret），测试文件零 env 依赖
- 路由工厂的插件参数类型：`Omit<AppOptions, 'corsOrigin'>`

### 5. 队列

- 队列名 / job 名 / payload 类型定义在领域内 `jobs.ts`（纯契约，零依赖）
- handler 只消费纯数据 `(data, logger)`，放在领域内（如 `domains/user/src/handlers.ts`）
- BullMQ 适配（createWorker/createDispatcher/Redis 连接）在 apps/worker；
  消费者在 `registry.ts` 注册；生产方在 app 侧 `createQueue`（默认 3 次重试 + 指数退避）

### 6. 数据库变更

1. 修改 `packages/database/src/schema/*.ts`
2. `pnpm --filter @epinfresh/database db:generate`
3. 检查生成的 SQL 并提交到 `packages/database/src/migrations/`（CI 会在真实 PG 重放）

## 测试

两类集成测试（都需要本地 postgres + redis）：

- **domain/usecase 测试**：直连 `TESTING_DATABASE_URL` 测试库（prepareTestDb / resetDb / flushTestRedis）
- **app 路由级测试**（`apps/*/src/app.test.ts`）：`buildApp(createTestDeps(...))` 注入 test 依赖，Eden treaty 调接口

Eden treaty 返回判别联合，断言用收窄而非可选链：

```ts
const res = await api.orders.post({ items: [...] }, { fetch: { headers: { cookie } } })
if (res.error !== null) throw res.error
expect(res.data.totalAmount).toBe('15.00')

// 错误分支：
if (res.error === null) throw new Error('expected error response')
expect(res.error.value).toMatchObject({ error: 'SKU_NOT_FOUND' })
```

## 质量与工具

- pre-commit 自动执行 Prettier + ESLint；commit-msg 校验 Conventional Commits（feat/fix/refactor/docs/ci/chore…）
- `ponytail:` 开头的注释 = 已知技术债（含背景与解决方向），新债沿用该标记
- 编辑器：Zed 配置在 `.zed/settings.json`（Prettier 保存格式化；Biome 已剔除，装 ESLint 扩展获得编辑器内诊断）

## CI / Docker

- GitHub Actions：ESLint + Prettier → typecheck → build → commitlint → 真实 Postgres 迁移重放
- 镜像：根目录 Dockerfile，`--build-arg APP=<app 名>` 选择服务；docker compose 含 migrate 前置服务
