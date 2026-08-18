# 微信支付 Native 接入与本地模拟器

## 背景

微信支付没有官方沙箱环境，所以仓库里提供了一个**本地微信支付模拟器** `apps/pay-mock-server`，作为开发/CI 的 de-facto 沙箱长期保留。它模拟微信服务端行为：

- 校验商户出站请求的 `WECHATPAY2-SHA256-RSA2048` 签名（含 5 分钟时间窗）
- 返回 Native 下单结果（`prepay_id` + `weixin://wxpay/bizpayurl?pr=…`）
- 提供 `/v3/certificates`（加密返回假平台公钥，供运行时拉取公钥的链路测试）
- 构造"支付成功"回调：资源按 APIv3 AES-256-GCM 加密、整包按假平台私钥签名，投递到通知地址
- `GET /v3/pay/transactions/out-trade-no/:no`（验商户签名后按内存登记返回 trade_state，供对账）
- `POST /__simulate__/close`（把已登记交易置为 CLOSED，模拟用户超时未支付）

与真实微信的差异仅在于密钥来源：接受本地生成的商户签名、用本地假平台密钥签发回调。将来支付宝 mock 复用同一套"假平台签名"模式（`src/alipay.ts`）。

## 双轴配置

支付接入由两个独立开关控制，可任意组合：

| 轴   | 变量              | 说明                                                                            |
| ---- | ----------------- | ------------------------------------------------------------------------------- |
| 渠道 | `PAYMENT_GATEWAY` | `mock`（本地无加密快速通道，e2e 依赖）/ `wechat` / `alipay`（见 alipay-pay.md） |
| 端点 | `WECHAT_API_BASE` | 真实 `https://api.mch.weixin.qq.com` / 模拟器 `http://localhost:8787`           |

其余 `WECHAT_*`（商户号/证书/密钥路径/回调地址）只在 `PAYMENT_GATEWAY=wechat` 时必需，`createPaymentGatewaysFromEnv` 会运行时校验。

前端渠道由构建环境 `VITE_PAYMENT_CHANNEL` 决定（默认 `mock`），写入 `apps/storefront-web/.env` 即可切到 `wechat`。

## 支付单关键字段语义

| 字段                      | 内容                                                                                    | 生命周期 / 用途                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `out_trade_no`            | 商户侧交易号（32 位 hex，我们生成）                                                     | 下单时落库；**全链路主关联键**（下单/回调定位/对账查询/退款提交）                                                 |
| `provider_ref`            | 渠道下单凭证（不透明，各渠道自定义：微信 `prepay_id`、支付宝 `qr_code`、mock `mock-*`） | 下单成功回填；Native 流程不消费（前端只用 code_url），存作凭证 + 供未来 JSAPI/H5 拉起支付用；admin 渠道单号列展示 |
| `provider_transaction_id` | 渠道交易号（微信 `transaction_id` / 支付宝 `trade_no`）                                 | 支付成功回调/对账回填；部分唯一索引防重复确认                                                                     |
| `payload`                 | 渠道载荷 `{type, codeUrl…}`                                                             | 下单成功回填；前端按 type 渲染（qr/redirect/params）                                                              |

## 本地联调

```bash
# 1. 生成联调密钥(商户私钥 + 假平台密钥对 + APIv3 key), 输出可追加到 .env 的配置
pnpm keys:pay

# 2. 把脚本输出的变量追加到根 .env(参考 .env.example), 关键项:
#    PAYMENT_GATEWAY=wechat, WECHAT_API_BASE=http://localhost:8787, 各 WECHAT_*/PAY_MOCK_* 路径
#    前端: apps/storefront-web/.env 写入 VITE_PAYMENT_CHANNEL=wechat

# 3. 启动
pnpm dev   # storefront-api :3000 + pay-mock-server :8787

# 4. 网页下单支付, 页面展示 weixin:// 二维码(本地扫码无意义)
# 5. 用任意 HTTP 客户端模拟支付完成(amount 为元字符串, 必须与订单金额一致)
curl -X POST http://localhost:8787/__simulate__/pay \
  -H 'content-type: application/json' \
  -d '{"outTradeNo":"<支付单 out_trade_no>","amount":"25.00"}'
# 返回 { sent:true, status:200, responseBody:"SUCCESS" } 即回调被真实 notify 路由接受
# 前端支付页每 3s 轮询订单状态, ≤3s 内自动从"扫码支付"翻到"支付成功"
```

`out_trade_no` 可从 storefront-api 的支付单列表接口拿到（`/orders/:id/payments`）。

## 前端支付结果感知（轮询）

支付页发起支付拿到二维码后，前端每 3s 轮询订单详情（`GET /orders/:id`），直到订单离开 `pending` 态：

- 变 `paid/shipped/completed` → 自动翻页到"支付成功"
- 变 `cancelled/refunded` → 自动展示对应终态（不再依赖首次加载的快照）
- 轮询期间请求瞬时失败会静默重试下一轮；会话失效则跳登录
- 自动轮询上限 5 分钟：超时未支付则停止轮询，二维码下方提示「订单仍待支付；若已支付请刷新页面」，避免无限空转

实现位于 `apps/storefront-web/src/routes/pay.tsx`。mock 渠道的「模拟支付完成」按钮保留，点击后同样落到 `status='paid'`。若后续并发上来自建一个轻量支付状态端点（如 `GET /payments/:id/status`）可省去拉取整个订单，记入 tech-debt。

## 对账（reconciliation）

渠道回调偶发丢失/延迟会导致"渠道已支付、本地仍 pending"的漂移，靠对账兜底。worker 的支付对账任务每 5 分钟跑一次，扫描**创建超 30 分钟仍 pending** 且渠道支持查询（实现了 `queryPayment`）的支付单：

- 渠道侧 `paid` → 视为漏回调，走与真实 webhook 相同的幂等确认管线（含 transaction_id 回填 + 金额校验），订单与支付单置为已支付
- 渠道侧 `closed`（超时未支付）→ 本地支付单置 `cancelled`，订单保持 pending，用户可重新发起
- `unpaid` / 查询失败 → 保持原样，下一轮再扫（幂等）
- mock 渠道无外部真值、不实现 `queryPayment`，自动跳过

实现：`usecases/payment-confirm` 的 `reconcilePendingPayments` + `apps/worker/src/reconciliationWorker.ts`（repeatable job）。联调可手动触发：`curl -X POST http://localhost:8787/__simulate__/pay`（模拟支付）或 `__simulate__/close`（模拟关闭）后等下一轮对账观察自动修复。

支付配置（`PAYMENT_GATEWAY`/`WECHAT_*`/PEM 读取/校验）由 `domains/payment` 的 `createPaymentGatewaysFromEnv` 统一提供，storefront-api / admin-api / worker 三进程同一来源。

## 退款

退款走渠道网关：admin-api 的 `POST /admin/orders/:id/refund` → `refundOrderWorkflow` **先向渠道提交退款**，再按渠道结果落地：

- **同步渠道**（mock/支付宝，返回 succeeded）：事务内翻转本地（order refunded + payment refunded）+ 退款单 succeeded
- **异步渠道**（微信，返回 processing）：落**退款单 processing**（`refunds` 表），订单/支付单保持现状；最终结果由**退款通知**驱动——`REFUND.SUCCESS` → 退款单 succeeded + 支付单 refunded + 订单 refunded（订单已取消则跳过订单翻转）；`REFUND.ABNORMAL` → 退款单 abnormal 不翻转
- 退款编号确定性派生：`rf-{paymentId}` —— 同一支付单的重试复用相同 `out_refund_no`，渠道侧幂等；已存在退款单时重复提交返回 409
- 退款通知走同一个 `/payments/notify/wechat` 入口（验签 → `confirmByWebhookEvent` 分发到退款状态机 `confirmRefundByWebhookEvent`）
- 联调模拟：`POST /v3/refund/domestic/refunds`（pay-mock-server 验商户签名后返回 `status: SUCCESS`，走同步路径；异步路径由单元测试覆盖）

## 代码结构

```
domains/payment/src/
  wechat/crypto.ts        RSA 签名/验签、Authorization 头构造、防重放、AES-256-GCM 加解密
  config/wechat.ts        WechatGatewayConfig(密钥以 PEM 内容传入, 由调用方读文件)
  env.ts                  支付配置单一来源(PAYMENT_GATEWAY + WECHAT_* 解析/校验/读 PEM)
  gateways/wechat.ts      统一下单、回调验签(平台证书按 serial 轮换)、queryPayment、退款、退款通知映射
  service.ts              支付单/退款单事务原语(insertRefund/markRefundSucceeded/...)
apps/pay-mock-server/
  src/wechat.ts           假微信服务端(验商户签名、模拟下单/证书/回调构造/交易登记查询/关闭)
  src/server.ts           Bun.serve 路由装配
  src/cli.ts              dev 入口
usecases/payment-confirm/  确认编排 + confirmRefundByWebhookEvent(退款状态机) + reconcilePendingPayments
usecases/payment-refund/   退款编排(同步翻转 / 异步挂退款单)
apps/worker/src/
  reconciliationWorker.ts 对账 repeatable job(每 5 分钟)
```

## 平台证书轮换

微信会不定期更换平台证书（验签公钥）。网关内置证书缓存：`verifyWebhook` 按回调头 `wechatpay-serial`
从 `/v3/certificates` 拉取的证书列表中定位公钥（缓存未命中先拉取一次，间隔至少 1 分钟），
仍无则退回 `WECHAT_PLATFORM_PUBLIC_KEY_PATH` 配置的公钥。轮换后无需改配置。

## 真实接入清单（商户号到位后）

1. 商户号 + APIv3 密钥 + APIv3 证书（serial_no 与私钥）配置到 `.env`，`WECHAT_API_BASE` 切回 `https://api.mch.weixin.qq.com`
2. 平台公钥：`WECHAT_PLATFORM_PUBLIC_KEY_PATH` 只需放一份（首次初始化）；运行期由 `/v3/certificates` 拉取 + serial 匹配实现轮换，无需人工维护
3. `WECHAT_NOTIFY_URL` 指向公网可达的 `/payments/notify/wechat`（微信要求 HTTPS；支付结果与退款结果共用此入口）
4. Native 需使用真实商户号绑定的小程序/公众号 appid 参与签名校验（simulate 的 appid 目前不校验）
5. 退款为异步：admin 退款 → 微信处理 → `REFUND.SUCCESS` 通知 → 本地 refunds/payment/order 翻转（`refunds` 表）
6. 验证清单：1 分钱真实支付 → 回调 → 订单 paid + outbox 投递；重复回调幂等；金额不符拒绝；对账修复（故意丢回调）；admin 退款 → 退款通知 → refunded；取消已支付订单 → 退款

## 密码学要点

- 出站请求签名串：`{method}\n{canonicalUrl}\n{timestamp}\n{nonce}\n{body}\n`，RSA-SHA256 后 base64 放入 `Authorization`
- 回调验签串：`{timestamp}\n{nonce}\n{body}\n`，用平台公钥 RSA-SHA256 验签，时间窗 5 分钟防重放
- 回调 `resource` 用 APIv3 密钥 AES-256-GCM 解密（密文尾部 16 字节为 auth tag），解密后再做金额等业务校验
- 金额以分为单位传给微信；回调金额与支付单不符一律拒绝（防伪造回调）
