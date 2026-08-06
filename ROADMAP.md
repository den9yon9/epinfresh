# ROADMAP.md

## 项目定位

epinfresh 是生鲜电商后端，pnpm + Turborepo Monorepo，Bun 运行时，ElysiaJS + Drizzle + BullMQ。架构约定见 `CONTRIBUTE.md`（分层依赖由 eslint-plugin-boundaries 编译期强制）。

## 现状评估

### 已完成

- **User/Auth**：注册 / 登录 / 登出 / me，Redis 会话 + 签名 Cookie，登录限流，dummy-hash 防时序枚举（`domains/user`）
- **Product**：商品 / 分类 / SKU CRUD + 库存扣减，storefront 与 admin 双端 API（`domains/product`）
- **Worker**：邮件队列（welcome / reset-password），handler 目前仅打日志（`domains/user/src/handlers.ts`）
- **基建**：DB schema + 迁移、Docker compose、CI（lint/typecheck/build/真实 PG 迁移）、/docs

### 占位 / 缺口

- **Checkout 是占位**：`checkoutWorkflow` 仅扣库存，不建订单（`domains/checkout/src/service.ts:11`）
- **无订单表**：没有 `orders` / `order_items`，无订单状态机、历史、支付入口
- **零测试**：全仓无 test；CI 不跑测试
- **密码重置不完整**：只有 job 名和 stub handler，无 forgot/reset 接口和 token 机制
- **邮件 handler 是 stub**：welcome job 已入队但只打日志

## 里程碑

### M1 测试基建（先行）

目标：用 `bun test`（Bun 内置，不引入新框架）+ 真 PostgreSQL 集成测试，为现有核心逻辑加回归保护。

- 覆盖：`reduceProductStock`、`checkoutWorkflow`、注册 / 登录
- 测试库配置走根 `.env.test`（`TEST_DATABASE_URL`，测试自动建库 + 迁移）
- CI 增加测试步骤
- 验收：`pnpm test` 通过，CI 全绿

### M2 订单领域（核心）

目标：把占位 checkout 变成真正的下单流程。

- `orders` / `order_items` 表 + 迁移（快照商品名 / 单价）
- 下单事务：原子扣库存 + 建单 + 建订单项
- 订单状态机（pending / paid / shipped / completed / cancelled 等，按需裁剪）
- storefront：用户查自己的订单列表 / 详情
- admin：订单列表 / 详情 / 状态流转
- 验收：下单成功落库且库存正确扣减，并发扣库存不超卖

### M3 密码重置

- `forgot-password`：生成一次性过期 token（写入 DB 或 Redis），投递 `RESET_PASSWORD` job
- `reset-password`：校验 token + 新密码，更新密码
- 验收：token 一次性、过期失效

### M4 收货地址

- `addresses` 表 + 迁移
- 用户地址 CRUD；下单时挂收货地址
- 验收：地址归属校验（只能用自己的地址下单）

### M5 真实邮件

- 把 email handler 从打日志换成真实邮件服务（现有 queue + 契约已就绪，只换发送端）
- 验收：注册 / 重置密码实际发出邮件

## 技术债登记

沿用 `ponytail:` 注释标记，新债一并登记：

- `domains/checkout/src/service.ts` — checkout 占位，userId 未使用，M2 落地
- `apps/storefront-api/src/routes/user.ts:27` — welcome job 不带 requestId，无法回溯到请求；接真邮件/支付回执时在 payload 带上
- 认证路径无测试，M1 补齐
- 库存扣减依赖事务内行锁，无并发验证，M1/M2 覆盖
