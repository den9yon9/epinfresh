# epinfresh

领域驱动的电商后端 monorepo，C 端与 B 端 API 分进程部署，基于 Bun + ElysiaJS。

> 私有项目，未发布到 npm。

## 技术栈

| 层面 | 选型 |
|------|------|
| 包管理 / 编排 | pnpm workspaces + Turborepo |
| 运行时 | Bun |
| 后端框架 | ElysiaJS |
| ORM / 数据库 | Drizzle ORM + PostgreSQL |
| 缓存 / 会话 | Redis（ioredis） |
| 校验 | TypeBox |
| 错误处理 | neverthrow `Result` |
| 日志 | pino（结构化） |
| 代码风格 | Biome |
| Git 钩子 / 提交规范 | lefthook + commitlint（Conventional Commits） |
| CI | GitHub Actions |

## 快速开始

### 前置依赖

- [Bun](https://bun.sh) >= 1.2
- [pnpm](https://pnpm.io) >= 10（启用 corepack 自动对齐 `packageManager` 字段）
- Docker（本地 PostgreSQL / Redis）

### 启动

```bash
pnpm install                                            # 安装依赖（含 lefthook 钩子）
cp .env.example .env                                    # 复制环境变量
docker compose -f docker/docker-compose.yml up -d       # 启动 PostgreSQL + Redis
pnpm dev                                                # 跑迁移 + 启动两个 API 服务
```

`pnpm dev` 会先执行数据库迁移（`turbo migrate`），再启动 `api-www` 与 `api-admin`。

### 访问入口

| 服务 | 地址 |
|------|------|
| C 端 API | http://localhost:3000 |
| B 端 API | http://localhost:3001 |
| C 端 OpenAPI 文档 | http://localhost:3000/docs |
| B 端 OpenAPI 文档 | http://localhost:3001/docs |
| 健康检查 | `GET /health` |

## 仓库结构

```
epinfresh/
├── config/tsconfig/        # 共享 tsconfig 基座
├── packages/
│   ├── shared/             # 跨层契约：类型、常量、env、日志、通用 model
│   └── database/           # Drizzle schema、db 连接、迁移
├── domains/
│   ├── session/            # 基础设施域：Redis、会话、限流
│   ├── user/               # 用户 / 认证域
│   └── product/            # 商品 / 分类域
├── apps/
│   ├── api-www/            # C 端 API（:3000）
│   └── api-admin/          # B 端 API（:3001）
└── docker/                 # 本地 docker-compose
```

分层依赖方向：`shared`（叶）← `database` / `session`（兄弟基础设施）← 业务域 ← `apps`。业务域之间互不依赖，由 app 装配组合。

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 跑迁移 + 启动所有服务 |
| `pnpm build` | 构建所有子包 |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm lint` | Biome 检查（只读） |
| `pnpm format` | Biome 检查并自动修复 |
| `pnpm --filter @epinfresh/database db:generate` | 生成数据库迁移 |
| `pnpm --filter @epinfresh/database db:migrate` | 执行数据库迁移 |

## 文档

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 贡献指南与编码规范（**提交前必读**）
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — 技术栈与阶段规划
- [AGENTS.md](./AGENTS.md) — AI agent 协作硬约束
