# epinfresh

生鲜电商全栈项目：C 端商城 + B 端管理后台 + 多渠道支付体系。pnpm + Turborepo monorepo，Bun 运行时。

## 功能

| 模块     | 说明                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 商品目录 | 分类 / 商品 / 多 SKU / 上下架 / 分页                                                                                   |
| 购物车   | per-SKU 并发锁，不同商品可同时改数量                                                                                   |
| 结算     | 单事务扣库存 + 幂等键防重复下单                                                                                        |
| 订单     | 状态机（pending → paid → shipped → completed / cancelled / refunded），CAS 推进                                        |
| 支付     | 渠道无关核心 + 注册表：**mock 沙箱 / 微信支付 APIv3（Native·H5·JSAPI）/ 支付宝当面付**，验签回调 + 金额防伪 + 幂等确认 |
| 退款     | 异步两段式状态机（refunds 表），abnormal 自动换号重试                                                                  |
| 对账     | worker 周期扫描超时支付单/退款单，拉渠道侧真值兜底修复                                                                 |
| 管理后台 | Dashboard、订单发货、商品/分类/用户 CRUD、全额退款                                                                     |
| 邮件通知 | outbox 事件 → 邮件队列 → SMTP：欢迎 / 找回密码 / 支付成功（`MAIL_TRANSPORT=console\|smtp`）                            |
| 用户     | 注册登录（argon2）/ 找回密码 / Redis 会话 / 路由级限流 / 微信公众号 OAuth                                              |

## 架构

目录即分层，依赖方向由 eslint-plugin-boundaries 编译期强制单向无环；域之间禁止互调，跨域编排只允许发生在 usecases：

```
apps/        presentation  薄壳: storefront-api/web · admin-api/web · worker · pay-mock-server · e2e
usecases/    编排层        跨域用例: checkout · order-cancel · payment-confirm · payment-refund
domains/     实体域        user · address · cart · product · order · payment · outbox
packages/    基础设施      database · http · queue · redis · session · shared · tsconfig
```

- 每个域固定三文件：`model.ts`（TypeBox DTO）/ `service.ts`（纯业务，neverthrow Result）/ `index.ts`（公共出口）
- 错误码 `err('SCREAMING_SNAKE')`，控制器 switch 穷举 + `assertNever`——新增错误码 = 编译错误
- Outbox 模式：业务写入与事件落库同事务，worker 每 2s 原子抢占投递（`FOR UPDATE SKIP LOCKED`），失败指数退避、5 次死信
- 队列契约（队列名/job 名/payload）定义在领域内 `jobs.ts`，消费者在 `apps/worker` 注册

## 技术栈

ElysiaJS + TypeBox（API 契约）、Drizzle + postgres.js（ORM）、BullMQ（队列）、Redis 会话、React 19 + TanStack Router + Tailwind 4（前端）、Playwright（e2e）、neverthrow（Result）、Turborepo。

## 快速开始

```bash
pnpm install
cp .env.example .env    # SESSION_SECRET: openssl rand -base64 32
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm dev                # 自动迁移 + 全部服务 watch
```

| 服务                     | 地址                           |
| ------------------------ | ------------------------------ |
| storefront-api / Swagger | http://localhost:3000（/docs） |
| storefront-web           | http://localhost:5173          |
| admin-api / Swagger      | http://localhost:3001（/docs） |
| admin-web                | http://localhost:5174          |
| pay-mock-server          | http://localhost:8787          |

常用命令：`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e` / `pnpm build` / `pnpm keys:pay`（生成本地支付密钥对）。

测试需要本地 postgres + redis（`TESTING_*` 配置见 `.env.example`）。

## 支付联调

没有真实商户账号也能完整联调——`pay-mock-server` 是本地"假支付平台"，模拟微信 APIv3（签名/验签/证书）与支付宝 RSA2 网关及回调：

1. `pnpm keys:pay` 生成商户/平台密钥对（写入 `keys/`）
2. `.env` 中 `PAYMENT_GATEWAY=mock`（或 `wechat,alipay` 多渠道并存，密钥路径指向 keys/ 下的 PEM）
3. 渠道 `*_API_BASE` 指向 `http://localhost:8787` 即走本地模拟器

切真实网关 = 换 `.env`（`PAYMENT_GATEWAY` + 真实密钥/商户号 + `*_API_BASE` 指向官方端点），代码零改动。详见 [docs/payment-flow.md](docs/payment-flow.md)。

## 文档索引

| 文档                                         | 内容                                           |
| -------------------------------------------- | ---------------------------------------------- |
| [CONTRIBUTE.md](CONTRIBUTE.md)               | 分层规范、开发模式、动手写（新增域/用例/路由） |
| [docs/payment-flow.md](docs/payment-flow.md) | 支付主链路、渠道注册表、退款状态机、对账       |
| [docs/wechat-pay.md](docs/wechat-pay.md)     | 微信支付联调与本地模拟器                       |
| [docs/alipay-pay.md](docs/alipay-pay.md)     | 支付宝当面付联调                               |
| [docs/tech-debt.md](docs/tech-debt.md)       | 技术债索引（`ponytail:` 标注 + 偿还触发条件）  |

## License

[MIT](LICENSE)
