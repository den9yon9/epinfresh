# TECH-DEBT.md — 技术债索引

> 索引全仓 `ponytail:` 标注的已知技术债。每条约一行 + 偿还触发条件；
> 新债沿用 `ponytail:` 注释标记并在此登记。排序: 偿还触发越近越靠前。

## 债项

| #   | 位置                                                                                       | 债                                                                         | 触发条件 / 偿还时机                                    |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `apps/admin-web/src/libs/api/types.ts`、`_admin/users.tsx:42`、`_admin/orders/$id.tsx:142` | eden treaty 子路径 PATCH body 坍缩为 `never`，调用需 `as never`            | elysia 2.0 + eden 2.x 发版后实测确认修复               |
| 2   | `packages/session/src/sessionPlugin.ts:137`                                                | `destroyAllForUser` O(n) 全量 scanStream                                   | 会话量到需每次登录 SADD 维护 per-user 索引时           |
| 3   | `packages/session/src/rateLimit.ts:12`                                                     | nazli 顶层规则会全局 onRequest 计数（曾 429 全 API）；限流只走路由级宏     | 换库或修 nazli 后移除 workaround 说明                  |
| 4   | `apps/storefront-api/src/routes/payment.ts:82`                                             | mock 网关回调入口（需登录）                                                | 接真实网关 + webhook 验签（AUDIT #2，冻结中）          |
| 5   | `domains/user/src/handlers.ts:13`                                                          | mock 邮件只打日志，token 拼在重置链接                                      | 接真实邮件服务                                         |
| 7   | `apps/storefront-web/src/components/Header.tsx:6`                                          | `staticData` 类型太松，读侧用窄接口断言                                    | 收紧路由 meta 类型                                     |
| 8   | `packages/database/src/fixtures.ts:384`                                                    | `orderItems.sku_id` restrict 外键，删除被拒时预检报错而非级联              | 若改级联需迁移，属刻意决策                             |
| 9   | `domains/address/src/service.ts:19`                                                        | 默认唯一性靠事务内先清后设，无部分唯一索引                                 | 地址量级变大后加 `(user_id, is_default)` 部分唯一索引  |
| 10  | `apps/admin-web/src/routes/_admin/categories.tsx:6`                                        | 分类一页拉完不分页（PAGE_SIZE=100）                                        | 分类超 100 时加分页                                    |
| 11  | `apps/admin-web/src/components/ProductForm.tsx:266`                                        | SKU 行可改可增不可删（restrict 外键）                                      | 若允许删 SKU，需处理历史订单引用（归档/软删）          |
| 12  | `packages/http/src/serverFactory.ts:13`                                                    | 只认 `x-request-id` 请求头                                                 | 网关若用 `x-correlation-id` 等需加进数组               |
| 13  | `packages/shared/src/env.ts:4`                                                             | elysia 进程自注册 `uri` format；worker 需手动补注册                        | 随 elysia 2.0 schema 内核替换确认是否消失              |
| 14  | `apps/storefront-web/src/libs/api/client.ts:4`、`apps/admin-web/src/libs/api/client.ts:4`  | treaty base 必须完整 URL，`''` 会补 https:// 前缀                          | eden 修复 base 解析                                    |
| 15  | `apps/storefront-web/vite.config.ts:10`、`apps/admin-web/vite.config.ts:10`                | 全量代理到 API，HttpOnly cookie 同源透传                                   | 生产走 nginx，本地 dev 简化方案                        |
| 16  | `apps/e2e/playwright.config.ts:12`                                                         | iPhone 13 默认 webkit，显式指回 chromium                                   | 装 webkit 后可移除                                     |
| 17  | `packages/database/src/transaction.ts`                                                     | `isResult` 鸭子探测（framework 无 Result 语义）                            | 框架提供 Result 语义后替换                             |
| 18  | `packages/session/src/sessionPlugin.ts` 等                                                 | `as unknown as` 逃逸点                                                     | 随 elysia 2.0 升级逐处清理                             |
| 19  | `apps/storefront-api/src/routes/user.ts:78`、`apps/admin-api/src/routes/auth.ts:45`        | 认证限流 10/分→20/分（e2e 并行 IP 共享）                                   | 生产按真实风控调回                                     |
| 20  | `packages/shared/src/env.ts`（worker 侧）                                                  | 非 elysia 消费者手动补 format 注册                                         | 同 #13                                                 |
| 21  | `usecases/payment-refund/src/service.ts`                                                   | 真实微信退款是异步的（PROCESSING→退款通知），当前按"提交成功即记 refunded" | 接真实网关后补退款状态机 + 退款 notify 路由 + 退款对账 |

## 历史结清

- ~~表访问收敛回 domain~~（checkout/order-cancel 直读直删改调 `@epinfresh/address`/`@epinfresh/cart`/`@epinfresh/payment`，2026-08-15，AUDIT #1）
- ~~购物车全局串行锁~~（cart.tsx 已按 per-sku 粒度锁 `busySkuId`，不同商品可并发改数量，2026-08-18，tech-debt #6）
