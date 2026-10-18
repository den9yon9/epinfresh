# epinfresh

生鲜电商全栈项目：C 端商城 + B 端管理后台 + 多渠道支付体系。pnpm + Turborepo monorepo，Bun 运行时。

## 功能

| 模块     | 说明                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 商品目录 | 分类 / 商品 / 多 SKU / 上下架 / 分页                                                                                                   |
| 购物车   | per-SKU 并发锁，不同商品可同时改数量                                                                                                   |
| 结算     | 单事务扣库存 + 幂等键防重复下单；固定运费 + 满额包邮（env 可配）                                                                       |
| 订单     | 状态机（pending → paid → shipped → completed / cancelled / refunded），CAS 推进；确认收货 + 发货 7 天未确认自动完成 + 物流签收自动完成 |
| 支付     | 渠道无关核心 + 注册表：**mock 沙箱 / 微信支付 APIv3（Native·H5·JSAPI）/ 支付宝当面付**，验签回调 + 金额防伪 + 幂等确认                 |
| 退款     | 异步两段式状态机（refunds 表），abnormal 自动换号重试                                                                                  |
| 对账     | worker 周期扫描超时支付单/退款单，拉渠道侧真值兜底修复；物流轨迹轮询（mock 沙箱，快递100 待接入）                                      |
| 管理后台 | Dashboard、订单发货、商品/分类/用户 CRUD、全额退款                                                                                     |
| 邮件通知 | outbox 事件 → 邮件队列 → SMTP：欢迎 / 找回密码 / 支付成功 / 退款成功 / 发货（`MAIL_TRANSPORT=console\|smtp`）                          |
| 用户     | 注册登录（argon2）/ 找回密码 / Redis 会话 / 路由级限流 / 微信公众号 OAuth                                                              |
| i18n     | 后端用户文案（API 错误 / 限流 / 守卫 / 邮件）标记 + 提取，`Accept-Language` 协商，`en`·`zh-CN`                                         |

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

常用命令：`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e` / `pnpm build` / `pnpm i18n:extract`（生成/更新翻译 catalog，`pnpm i18n:check` 校验）/ `pnpm keys:pay`（生成本地支付密钥对）。

测试需要本地 postgres + redis（`TESTING_*` 配置见 `.env.example`）。

## 监控与压测

### Prometheus 指标端点（/metrics）

三个服务均暴露 Prometheus 文本格式指标（HTTP 全量请求计数/耗时直方图 + 运行时指标；worker 另含 BullMQ 队列 job counts）：

| 服务           | 端点                                                | 说明                                                    |
| -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| storefront-api | `http://localhost:3000/metrics`                     | 含支付回调验签计数（`payment_webhook_results_total`）   |
| admin-api      | `http://localhost:3001/metrics`                     | 后台接口计数                                            |
| worker         | `HEALTH_PORT`（如 `http://localhost:8088/metrics`） | 含各队列 waiting/active/failed 等计数（每次抓取时刷新） |

接入监控平台（Prometheus/Grafana 等）直接抓取即可；`/metrics` 无鉴权，生产建议内网或监控白名单访问。

### 本地监控面板（可选，一键起）

仓库在 `monitoring/` 维护一套**原生优先**的监控配置（单一事实源：`prometheus.yml` + Grafana provisioning + 大屏 JSON）。本地开发时先确保业务服务在跑（`pnpm dev`），worker 面板需在 .env 启用 `HEALTH_PORT=3100`。

**原生（不用 Docker，推荐）**：

```bash
# 一次性安装: brew install prometheus grafana
scripts/monitoring-up.sh
# 打开 http://localhost:3005 → 控制台 admin/admin, "epinfresh 总览" 大屏已自动导入
# Prometheus 自查询: http://localhost:9090/graph  (Ctrl+C 停止 Grafana 并连带停掉 Prometheus)
```

**Docker（可选）**：

```bash
docker compose -f docker/docker-compose.observability.yml up -d
# 跑完清理: docker compose -f docker/docker-compose.observability.yml down
```

- 预设 6 块面板：请求量、错误量、P95 延迟、支付回调验签、BullMQ 队列堆积、进程内存
- 监控目标：原生用 `monitoring/prometheus.yml`（`localhost:3000/3001/3100`，改端口直接改这里）；Docker 用 `docker/prometheus.docker.yml`（`host.docker.internal:…`）。Prometheus 配置文件不支持 `${VAR}` 环境变量替换，故原生/容器各一份
- 原生与 Docker 的 Grafana datasource 地址不同：原生用 `monitoring/grafana/provisioning/datasources/datasources.yml`（`http://localhost:9090`），Docker 用 `docker/grafana/datasources.docker.yml`（`http://prometheus:9090`）。provisioning 文件须放在 `datasources/`、`dashboards/` 子目录下 Grafana 才会扫描；Grafana provisioning 支持 `${VAR}` 插值
- worker 指标需在 .env 启用 `HEALTH_PORT`（默认 3100）才暴露 `/metrics`
- Grafana ≥12 只提供 `grafana` 二进制（用 `grafana server` 启动），脚本已自动适配新旧版本；大屏路径经 `${EPINFRESH_DASHBOARDS_PATH}` 环境变量注入，无需依赖工作目录
- 若 9090/3005 被上次遗留进程占用，脚本会提示 `kill <pid>` 后再跑，不会强行双开
- 监控栈不写进 `docker/docker-compose.yml`，避免污染业务编排

### k6 压测（结算下单链路）

前置：本地起 `pnpm dev`，并用验收账号（`buyer@example.com` / `buyer123456`）登录商城往购物车加 1 件商品（脚本默认从购物车读取结算项；买家若无收货地址，脚本会在 setup 阶段自动建一条，避免下单链路空转）。`setup()` 还会**自动补购物车**：若购物车为空（下单结算会删除结算涉及的 SKU），会自动取一个有库存的商品加购，无需每次手动播种。

```bash
# 默认 25 并发 1 分钟(错误率<1%, P95<800ms 阈值)
k6 run scripts/k6/checkout.js
# 50 并发 2 分钟
k6 run --vus 50 --duration 2m scripts/k6/checkout.js
```

脚本关键点：**只在 `setup()` 登录一次**，跨 VU 复用同一 session（每个 VU 每迭代才新建 `Idempotency-Key`、专注写入；不逐迭代登录，避免打爆 `AUTH_RATE_LIMIT_PER_MINUTE` 登录限流）；自动断言 422（幂等漂移）与 409（库存不足）为异常命中。注意：压测属写入型，每单逐轮扣库存，建议用高库存 SKU 或缩短 duration，否则会命中 409 库存不足。k6 为独立二进制，未写入 devDependencies。

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
| [docs/i18n.md](docs/i18n.md)                 | 后端用户文案 i18n：标记 + 提取、语言协商、邮件 |
| [docs/payment-flow.md](docs/payment-flow.md) | 支付主链路、渠道注册表、退款状态机、对账       |
| [docs/wechat-pay.md](docs/wechat-pay.md)     | 微信支付联调与本地模拟器                       |
| [docs/alipay-pay.md](docs/alipay-pay.md)     | 支付宝当面付联调                               |
| [docs/tech-debt.md](docs/tech-debt.md)       | 技术债索引（`ponytail:` 标注 + 偿还触发条件）  |

## License

[MIT](LICENSE)
