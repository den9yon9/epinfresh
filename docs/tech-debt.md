# TECH-DEBT.md — 技术债索引

> 索引全仓 `ponytail:` 标注的已知技术债。每条约一行 + 偿还触发条件；
> 新债沿用 `ponytail:` 注释标记并在此登记。排序: 偿还触发越近越靠前。

## 债项

| #   | 位置                                                                                       | 债                                                                                                     | 触发条件 / 偿还时机                                                                                        |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | `apps/admin-web/src/libs/api/types.ts`、`_admin/users.tsx:42`、`_admin/orders/$id.tsx:142` | eden treaty 子路径 PATCH body 坍缩为 `never`，调用需 `as never`                                        | elysia 2.0 + eden 2.x 发版后实测确认修复                                                                   |
| 2   | `packages/session/src/sessionPlugin.ts:137`                                                | `destroyAllForUser` O(n) 全量 scanStream                                                               | 会话量到需每次登录 SADD 维护 per-user 索引时                                                               |
| 3   | `packages/session/src/rateLimit.ts:12`                                                     | nazli 顶层规则会全局 onRequest 计数（曾 429 全 API）；限流只走路由级宏                                 | 换库或修 nazli 后移除 workaround 说明                                                                      |
| 4   | `apps/storefront-api/src/routes/payment.ts:82`                                             | mock 网关回调入口（需登录）                                                                            | 接真实网关 + webhook 验签（AUDIT #2，冻结中）                                                              |
| 7   | `apps/storefront-web/src/components/Header.tsx:6`                                          | `staticData` 类型太松，读侧用窄接口断言                                                                | 收紧路由 meta 类型                                                                                         |
| 8   | `packages/database/src/fixtures.ts:384`                                                    | `orderItems.sku_id` restrict 外键，删除被拒时预检报错而非级联                                          | 若改级联需迁移，属刻意决策                                                                                 |
| 9   | `domains/address/src/service.ts:19`                                                        | 默认唯一性靠事务内先清后设，无部分唯一索引                                                             | 地址量级变大后加 `(user_id, is_default)` 部分唯一索引                                                      |
| 10  | `apps/admin-web/src/routes/_admin/categories.tsx:6`                                        | 分类一页拉完不分页（PAGE_SIZE=100）                                                                    | 分类超 100 时加分页                                                                                        |
| 11  | `apps/admin-web/src/components/ProductForm.tsx:266`                                        | SKU 行可改可增不可删（restrict 外键）                                                                  | 若允许删 SKU，需处理历史订单引用（归档/软删）                                                              |
| 12  | `packages/http/src/serverFactory.ts:13`                                                    | 只认 `x-request-id` 请求头                                                                             | 网关若用 `x-correlation-id` 等需加进数组                                                                   |
| 13  | `packages/shared/src/env.ts:4`                                                             | elysia 进程自注册 `uri` format；worker 需手动补注册                                                    | 随 elysia 2.0 schema 内核替换确认是否消失                                                                  |
| 14  | `apps/storefront-web/src/libs/api/client.ts:4`、`apps/admin-web/src/libs/api/client.ts:4`  | treaty base 必须完整 URL，`''` 会补 https:// 前缀                                                      | eden 修复 base 解析                                                                                        |
| 15  | `apps/storefront-web/vite.config.ts:10`、`apps/admin-web/vite.config.ts:10`                | 全量代理到 API，HttpOnly cookie 同源透传                                                               | 生产走 nginx，本地 dev 简化方案                                                                            |
| 16  | `apps/e2e/playwright.config.ts:12`                                                         | iPhone 13 默认 webkit，显式指回 chromium                                                               | 装 webkit 后可移除                                                                                         |
| 17  | `packages/database/src/transaction.ts`                                                     | `isResult` 鸭子探测（framework 无 Result 语义）                                                        | 框架提供 Result 语义后替换                                                                                 |
| 18  | `packages/session/src/sessionPlugin.ts` 等                                                 | `as unknown as` 逃逸点                                                                                 | 随 elysia 2.0 升级逐处清理                                                                                 |
| 19  | `apps/storefront-api/src/routes/user.ts:42,79`、`apps/admin-api/src/routes/auth.ts:45`     | 认证限流注册/登录 20/分→40/分（e2e 并行 3 项目共享 IP，单跑约 23 次登录）                              | 生产按真实风控调回                                                                                         |
| 20  | `packages/shared/src/env.ts`（worker 侧）                                                  | 非 elysia 消费者手动补 format 注册                                                                     | 同 #13                                                                                                     |
| 24  | `usecases/checkout/src/fee.ts`、`apps/storefront-api/src/env.ts`                           | 运费仅支持固定费 + 满额包邮（无地区/重量维度）；配置走 env 重启生效                                    | 地址结构化(省市字段)与 SKU 重量字段落地后做地区×重量模板；运营需不重启调价时上 settings 表 + 后台配置      |
| 25  | `packages/database/src/schema/logistics/logistics-tracks.ts`、`domains/logistics`          | 轨迹为单包裹模型(一单一条)；承运商枚举固定 5 家；kuaidi100 provider 未实现(注册表抛错)                 | 需要多包裹/拆单发货时演进 shipments 表；新增承运商时扩枚举；有快递100 key 时补 provider 实现(调用方零改动) |
| 26  | `eslint-rules/cross-domain-read.js`(domains 侧 warn)                                       | 跨域读规则暂为 warn：payment→orders(行为性读, 待上移 usecase)、cart→products(展示读, 待读模型 usecase) | 两项重构完成后把 domains 侧规则从 warn 升 error(apps 侧已是 error)；届时删除本条                           |

## 历史结清

- ~~表访问收敛回 domain~~（checkout/order-cancel 直读直删改调 `@epinfresh/address`/`@epinfresh/cart`/`@epinfresh/payment`，2026-08-15，AUDIT #1）
- ~~购物车全局串行锁~~（cart.tsx 已按 per-sku 粒度锁 `busySkuId`，不同商品可并发改数量，2026-08-18，tech-debt #6）
- ~~异步退款状态机~~（refunds 表 + REFUND.SUCCESS/ABNORMAL 通知处理 + 支付单/订单联动，2026-08-18，tech-debt #21）
- ~~mock 邮件只打日志~~（welcome/找回密码/支付成功邮件经 email worker 真实发送，`MAIL_TRANSPORT=smtp` 接任意 SMTP，重置链接由 `STOREFRONT_WEB_URL` 拼接，2026-08-29，tech-debt #5）
- ~~退款/发货无邮件通知~~（`refund.succeeded` 事件在三个事务点写入：退款通知漏斗 `payment-confirm`、admin 同步退款 `payment-refund`、取消已付订单同步分支 `order-cancel`；`order.shipped` 由 shipOrder 的 `onShipped` 注入回调仅真实转变时写；abnormal 不通知用户，2026-08-29，tech-debt #22）
- ~~outbox 事件 claim 后崩溃卡 `processing`~~（dispatch 每 tick 先跑 `resetStaleOutboxEvents`：`updated_at` 超过 `OUTBOX_STALE_THRESHOLD_MS=5min` 的 processing 行复位 pending 重投，attempts 不清零自然收敛死信，误回收由 complete/fail 的 CAS guard + 邮件 jobId 去重兜底，重置行数 >0 记 warn，2026-08-29，tech-debt #23）
