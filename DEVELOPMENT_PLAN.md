# epinfresh 开发计划

## 技术栈

| 层面 | 选型 |
|------|------|
| 包管理 | pnpm workspaces |
| 任务编排 | Turborepo |
| 运行时 | Bun |
| 后端框架 | ElysiaJS |
| 认证 | Session（Redis 存储） |
| ORM | Drizzle ORM |
| 数据库 | PostgreSQL |
| 前端框架 | React + Vite |
| 前端路由 | TanStack Router（loader 做数据获取） |
| 代码风格 | Biome（format + lint） |
| 队列 | BullMQ (Redis) |
| 容器化 | Docker + docker-compose |

## 目录结构

```
epinfresh/
├── .github/workflows/
├── config/
│   └── tsconfig/                # @epinfresh/tsconfig
├── domains/
│   ├── user/                    # @epinfresh/user
│   ├── product/                 # @epinfresh/product
│   ├── cart/                    # @epinfresh/cart
│   ├── order/                   # @epinfresh/order
│   ├── payment/                 # @epinfresh/payment
│   ├── inventory/               # @epinfresh/inventory
│   ├── promotion/               # @epinfresh/promotion
│   ├── shipping/                # @epinfresh/shipping
│   └── notification/            # @epinfresh/notification
├── apps/
│   ├── api-www/                 # C端 API 服务（独立进程，端口 3000）
│   ├── api-admin/               # B端 API 服务（独立进程，端口 3001）
│   ├── worker/                  # 后台任务消费者（BullMQ）
│   ├── admin/                   # 管理后台界面（Vite + React + TanStack Router）
│   └── www/                     # C端商城界面（Vite + React + TanStack Router）
├── packages/
│   ├── shared/                  # @epinfresh/shared — 共享类型、工具函数
│   └── database/                # @epinfresh/database — Drizzle schema + TypeBox 模型
├── docker/
│   ├── Dockerfile.api-www
│   ├── Dockerfile.api-admin
│   ├── Dockerfile.admin
│   ├── Dockerfile.www
│   └── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── lefthook.yml
├── commitlint.config.js
├── .gitignore
└── .env.example
```

## 每个 domain 包的标准结构

```
domains/product/
├── src/
│   ├── model.ts         # Elysia model（TypeBox schema + InferModelsMap）
│   ├── service.ts       # 业务逻辑
│   ├── www.ts           # C端 Elysia 路由插件
│   ├── admin.ts         # B端 Elysia 路由插件
│   └── index.ts         # 导出 model + 路由插件
├── package.json          # name: @epinfresh/product
└── tsconfig.json
```

## 阶段划分

---

### Phase 1 — 基础设施（骨架搭建）

**目标：** 可运行的 monorepo + 可连接的数据库

| # | 任务 | 产出 |
|---|------|------|
| 1.1 | 初始化 pnpm workspace + turborepo | package.json, pnpm-workspace.yaml, turbo.json |
| 1.2 | 配置共享 tsconfig | config/tsconfig |
| 1.3 | 创建 `packages/shared`（工具函数、常量、基础类型） | @epinfresh/shared |
| 1.4 | 创建 `packages/database` | Drizzle schema、db 连接、drizzle-kit 配置 |
| 1.5 | PostgreSQL + Redis docker-compose | docker-compose.yml（含 pg、redis） |
| 1.6 | 初始化 `apps/api-www` 和 `apps/api-admin` 空服务 | 两个 Elysia 实例能启动，返回 health check |

**里程碑：** `pnpm dev` 能启动两个 API 服务，`GET /health` 返回 ok

---

### Phase 2 — 核心域：用户 + 商品

**目标：** 完成最基本的业务闭环 — 用户登录能看商品列表

| # | 任务 | 产出 |
|---|------|------|
| 2.1 | `user` — 用户表 schema、注册/登录 service、Session 认证 | @epinfresh/user |
| 2.2 | `apps/api-www` 接入 session 中间件 | 登录/登出/获取当前用户接口 |
| 2.3 | `apps/api-admin` 接入 admin token 认证 | admin 登录接口 |
| 2.4 | `product` — 商品表、分类表、SKU 表 schema | @epinfresh/product |
| 2.5 | `product` — C端列表/详情 service + www routes | C端商品接口 |
| 2.6 | `product` — B端 CRUD service + admin routes | B端商品管理接口 |

**里程碑：** C端可获取商品列表，B端可增删改商品

---

### Phase 3 — 交易闭环：购物车 → 订单 → 支付

**目标：** 完整购买流程跑通

| # | 任务 | 产出 |
|---|------|------|
| 3.1 | `cart` — 购物车 schema + 增删改查 | @epinfresh/cart |
| 3.2 | `order` — 订单/订单项 schema + 下单 service | @epinfresh/order |
| 3.3 | `inventory` — 库存 schema + 锁定/释放（与下单联动） | @epinfresh/inventory |
| 3.4 | `payment` — 支付渠道对接（微信/支付宝沙箱） | @epinfresh/payment |
| 3.5 | `order` — 支付回调处理、订单状态流转 | 支付成功 → 订单确认 |
| 3.6 | B端订单管理接口（列表/详情/发货/售后） | 订单管理 |

**里程碑：** 用户能加购 → 下单 → 支付 → 查看订单

---

### Phase 4 — 辅助域：营销 + 物流 + 通知 + 后台任务

**目标：** 补齐运营能力

| # | 任务 | 产出 |
|---|------|------|
| 4.1 | `promotion` — 优惠券/满减/秒杀 schema + service | @epinfresh/promotion |
| 4.2 | `shipping` — 运费模板/物流追踪 | @epinfresh/shipping |
| 4.3 | `notification` — 邮件/短信通知 | @epinfresh/notification |
| 4.4 | `apps/worker` — BullMQ 消费者（订单超时关闭、发货提醒等） | worker 服务 |

---

### Phase 5 — 前后端对接

**目标：** 两个前端能看到页面、能操作

| # | 任务 | 产出 |
|---|------|------|
| 5.1 | 初始化 `apps/www` — Vite + React + TanStack Router 空壳 | 页面框架 |
| 5.2 | 初始化 `apps/admin` — Vite + React + TanStack Router + admin 布局 | 页面框架 |
| 5.3 | www 接入 domain client：商品列表/详情页 | C端页面 |
| 5.4 | www 接入：登录/注册、购物车、下单流程 | C端全流程 |
| 5.5 | admin 接入：商品管理页面（列表/新建/编辑） | B端商品管理 |
| 5.6 | admin 接入：订单管理页面 | B端订单管理 |
| 5.7 | admin 接入：用户管理、优惠券管理 | B端其他页面 |

**里程碑：** C端和B端均能完整操作

---

### Phase 6 — 部署与 CI/CD

**目标：** 可部署到服务器

| # | 任务 | 产出 |
|---|------|------|
| 6.1 | 编写各服务 Dockerfile | Docker 镜像 |
| 6.2 | 完善 docker-compose（含 nginx 反向代理） | 一键启动 |
| 6.3 | GitHub Actions CI（lint / typecheck / build） | CI 流程 |
| 6.4 | .env 环境变量规范化 | 配置文档 |

---

## 优先级依赖关系

```
Phase 1 ────── 基础骨架（必须先完成）
    │
    ▼
Phase 2 ────── 用户 + 商品（核心领域先做）
    │
    ▼
Phase 3 ────── 交易闭环
    │
    ├──── Phase 4 ──── 辅助域（可与 Phase 5 并行）
    │
    ▼
Phase 5 ────── 前端对接（可提前与 Phase 3~4 并行）
    │
    ▼
Phase 6 ────── 部署上线
```

Phase 2~4 在开发后端接口时，同步编写对应 domain 包的 API client 函数，为 Phase 5 做准备。
