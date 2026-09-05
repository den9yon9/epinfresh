# TECH-DEBT.md — 技术债索引

> 索引全仓 `ponytail:` 标注的已知技术债。每条约一行 + 偿还触发条件；
> 新债沿用 `ponytail:` 注释标记并在此登记。排序: 偿还触发越近越靠前。

## 债项

| #   | 位置                                                                                       | 债                                                                                              | 触发条件 / 偿还时机                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `apps/admin-web/src/libs/api/types.ts`、`_admin/users.tsx:42`、`_admin/orders/$id.tsx:142` | eden treaty 子路径 PATCH body 坍缩为 `never`，调用需 `as never`                                 | elysia 2.0 + eden 2.x 发版后实测确认修复                                                                    |
| 2   | `packages/session/src/sessionPlugin.ts:137`                                                | ~~`destroyAllForUser` O(n) 全量 scanStream~~ 代码已实现 per-user SADD 索引，仅文档未同步        | 已结清，见历史结清（本行从债项表移除）                                                                      |
| 3   | `packages/session/src/rateLimit.ts:12`                                                     | nazli 顶层规则会全局 onRequest 计数（曾 429 全 API）；限流只走路由级宏                          | 换库或修 nazli 后移除 workaround 说明                                                                       |
| 4   | `apps/storefront-api/src/routes/payment.ts:82`                                             | mock 网关回调入口（需登录）                                                                     | 接真实网关 + webhook 验签（AUDIT #2，冻结中）                                                               |
| 7   | `apps/storefront-web/src/components/Header.tsx:6`                                          | `staticData` 类型太松，读侧用窄接口断言                                                         | 收紧路由 meta 类型                                                                                          |
| 8   | `packages/database/src/fixtures.ts:384`                                                    | `orderItems.sku_id` restrict 外键，删除被拒时预检报错而非级联                                   | 若改级联需迁移，属刻意决策                                                                                  |
| 12  | `packages/http/src/serverFactory.ts:13`                                                    | 只认 `x-request-id` 请求头                                                                      | 网关若用 `x-correlation-id` 等需加进数组                                                                    |
| 13  | `packages/shared/src/env.ts:4`                                                             | elysia 进程自注册 `uri` format；worker 需手动补注册                                             | 随 elysia 2.0 schema 内核替换确认是否消失                                                                   |
| 14  | `apps/storefront-web/src/libs/api/client.ts:4`、`apps/admin-web/src/libs/api/client.ts:4`  | treaty base 必须完整 URL，`''` 会补 https:// 前缀                                               | eden 修复 base 解析                                                                                         |
| 15  | `apps/storefront-web/vite.config.ts:10`、`apps/admin-web/vite.config.ts:10`                | 全量代理到 API，HttpOnly cookie 同源透传                                                        | 生产走 nginx，本地 dev 简化方案                                                                             |
| 16  | `apps/e2e/playwright.config.ts:12`                                                         | iPhone 13 默认 webkit，显式指回 chromium                                                        | 装 webkit 后可移除                                                                                          |
| 17  | `packages/database/src/transaction.ts`                                                     | `isResult` 鸭子探测（framework 无 Result 语义）                                                 | 框架提供 Result 语义后替换                                                                                  |
| 18  | `packages/session/src/sessionPlugin.ts` 等                                                 | `as unknown as` 逃逸点                                                                          | 随 elysia 2.0 升级逐处清理                                                                                  |
| 20  | `packages/shared/src/env.ts`（worker 侧）                                                  | 非 elysia 消费者手动补 format 注册                                                              | 同 #13                                                                                                      |
| 27  | `domains/user/src/jobs.ts`                                                                 | 全站邮件模板枚举(含 payment/refund/order 事件)宿主在 user 域，契约归属漂移                      | 新增通知渠道(短信/推送)或模板数 >10 时拆独立 notification 域/usecase；新增模板前先看 CONTRIBUTE §5 归属口径 |
| 28  | `usecases/*/src/service.ts` 错误联合                                                       | 错误联合为 `string \| { code, ...payload }` 混合形态，控制器每个 switch 前需 typeof 分流        | payload 错误 ≥3 个时一次性统一为纯对象判别联合 `{ code }`(机械化重构，类型管线保证控制器/前端同步)          |
| 29  | `usecases/checkout/src/service.ts` 幂等键                                                  | 幂等只认 `(userId, key)` 不校验 body hash；前端已在提交完结后重生成 key，当前 UI 流程无漂移路径 | 出现非浏览器客户端直调下单 API 时：幂等表加 `body_hash` 列，重放不匹配返回 422                              |

## 历史结清

- ~~表访问收敛回 domain~~（checkout/order-cancel 直读直删改调 `@epinfresh/address`/`@epinfresh/cart`/`@epinfresh/payment`，2026-08-15，AUDIT #1）
- ~~购物车全局串行锁~~（cart.tsx 已按 per-sku 粒度锁 `busySkuId`，不同商品可并发改数量，2026-08-18，tech-debt #6）
- ~~异步退款状态机~~（refunds 表 + REFUND.SUCCESS/ABNORMAL 通知处理 + 支付单/订单联动，2026-08-18，tech-debt #21）
- ~~mock 邮件只打日志~~（welcome/找回密码/支付成功邮件经 email worker 真实发送，`MAIL_TRANSPORT=smtp` 接任意 SMTP，重置链接由 `STOREFRONT_WEB_URL` 拼接，2026-08-29，tech-debt #5）
- ~~退款/发货无邮件通知~~（`refund.succeeded` 事件在三个事务点写入：退款通知漏斗 `payment-confirm`、admin 同步退款 `payment-refund`、取消已付订单同步分支 `order-cancel`；`order.shipped` 由 shipOrder 的 `onShipped` 注入回调仅真实转变时写；abnormal 不通知用户，2026-08-29，tech-debt #22）
- ~~outbox 事件 claim 后崩溃卡 `processing`~~（dispatch 每 tick 先跑 `resetStaleOutboxEvents`：`updated_at` 超过 `OUTBOX_STALE_THRESHOLD_MS=5min` 的 processing 行复位 pending 重投，attempts 不清零自然收敛死信，误回收由 complete/fail 的 CAS guard + 邮件 jobId 去重兜底，重置行数 >0 记 warn，2026-08-29，tech-debt #23）
- ~~跨域读规则 warn 过渡~~（`cross-domain-read` 上线时 domains 侧为 warn：payment→orders 行为性读已上移 `usecases/payment-initiate`（订单快照经 order 域 `getPayableOrder`，refund 侧冗余订单查询删除），cart→products 展示读改为 `usecases/cart-ops` 读模型拼装（product 域 `getSkuPurchaseInfo`/`getSkuViewsByIds` 原语），全部清偿后 domains 侧升 error，2026-09-02，tech-debt #26）
- ~~`destroyAllForUser` O(n) 全量 scanStream~~（per-user SADD 索引早已实现：`create` 时 `sadd`+`expire` 维护 `session:user:{id}` 集合，`destroyAllForUser` 走 `smembers` O(1) 取集合，tech-debt #2，文档滞后结清）
- ~~认证限流放宽值写死在路由~~（`AUTH_RATE_LIMIT_PER_MINUTE` env 化：默认 20 为生产风控口径，e2e 经 playwright webServer 行内 env 注入 40，storefront/admin 两 app 生效并写入 OpenAPI 描述，tech-debt #19）
- ~~地址默认唯一性无索引~~（部分唯一索引 `addresses_user_default_unique` 早已随迁移 0015 落地：`(user_id) WHERE is_default`；service 侧 `withDefaultRetry` 对并发 23505 重试一次——代码早于文档结清，tech-debt #9）
- ~~SKU 行可改可增不可删~~（product_skus 表新增 deleted_at 字段与 partial unique 索引，updateProduct 对未提交旧 SKU 执行软删，读模型过滤已删 SKU，历史订单不受影响，ProductForm 恢复删除交互，2026-09-05，tech-debt #11）
- ~~运费仅固定费 + 满额包邮~~（addresses 结构化(省/市/区/详) + product_skus.weight_grams + 多维运费引擎：基础运费、满额包邮(非偏远)、偏远省份加价与不包邮、首重/续重阶梯；运费配置仍走 env 重启生效，运营不重启调价时再上 settings 表+后台配置，2026-09-05，tech-debt #24）
- ~~分类一页拉完不分页~~（admin-web categories 改为 20/页分页导航绑定 URL search；后端接口原本就支持分页，2026-09-05，tech-debt #10）
