# 支付宝当面付（Native 扫码）接入与本地模拟

## 背景

与微信一致：仓库用 `apps/pay-mock-server` 的 `src/alipay.ts` 作为支付宝"假平台"（本地开发/CI 的 de-facto 沙箱），复用微信模拟器的商户/平台 RSA 密钥对，签名算法换成支付宝的 **RSA2**。

模拟器对齐真实支付宝行为：

- `/gateway.do`：校验商户出站请求 RSA2 签名，按 `method` 参数分发 `alipay.trade.precreate`（当面付下单→`qr_code`）/ `alipay.trade.query`（查询）/ `alipay.trade.refund`（同步退款）
- `POST /__simulate__/alipay/pay`：把交易置为 `TRADE_SUCCESS` 并投递表单异步通知到 notify 地址（假平台私钥签名）
- `POST /__simulate__/alipay/close`：交易置为 `TRADE_CLOSED`（对账据此取消支付单）

## 配置

与微信同一套双轴思路，`PAYMENT_GATEWAY=alipay` 时启用，其余 `ALIPAY_*` 必需（`createPaymentGatewaysFromEnv` 运行时校验）：

| 变量                          | 说明                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `ALIPAY_API_BASE`             | 真实 `https://openapi.alipay.com` / 模拟器 `http://localhost:8787` |
| `ALIPAY_APP_ID`               | 应用 AppID                                                         |
| `ALIPAY_APP_PRIVATE_KEY_PATH` | 应用私钥 PEM（`pnpm keys:pay` 的 `merchant_key.pem`）              |
| `ALIPAY_PUBLIC_KEY_PATH`      | 支付宝公钥 PEM（`platform_pub.pem`）                               |
| `ALIPAY_NOTIFY_URL`           | 异步通知地址（真实环境需公网 HTTPS）                               |

前端：`apps/storefront-web/.env` 写 `VITE_PAYMENT_CHANNEL=alipay`。

## 本地联调

```bash
# 1. 密钥复用: pnpm keys:pay 生成后, .env 追加上面的 ALIPAY_* 与 PAY_MOCK_ALIPAY_APP_ID
# 2. 启动: pnpm dev   # storefront-api :3000 + pay-mock-server :8787
# 3. 网页下单支付, 页面展示 alipay:// 二维码
# 4. 模拟支付完成(amount 为元字符串, 必须与订单金额一致)
curl -X POST http://localhost:8787/__simulate__/alipay/pay \
  -H 'content-type: application/json' \
  -d '{"outTradeNo":"<支付单 out_trade_no>","amount":"25.00"}'
# 返回 { sent:true, status:200, responseBody:"success" } 即回调被真实 notify 路由接受
# 前端支付页每 3s 轮询订单状态, ≤3s 内自动翻到"支付成功"
```

## 密码学要点

- 签名内容：除 `sign`/`sign_type` 与空值外的参数按 key 字节序排序，`k=v` 以 `&` 连接
- 签名算法：RSA2 = RSA-SHA256，base64（`domains/payment/src/alipay/crypto.ts`）
- 出站请求：表单 URL 编码 POST 到 `/gateway.do`，`biz_content` 为 JSON 字符串
- 异步通知：表单 URL 编码，验签通过后按 `trade_status` 映射：`TRADE_SUCCESS`/`TRADE_FINISHED`→succeeded；其余（`TRADE_CLOSED`/`WAIT_BUYER_PAY`）确认消费不落状态
- 应答体：处理成功回纯文本 `success`（支付宝要求）
- 退款是**同步**接口：`code=10000` 即成功，直接翻本地状态（比微信异步简单）
- 对账：`queryPayment`（`alipay.trade.query`）SUCCESS/FINISHED→paid、WAIT_BUYER_PAY→unpaid、CLOSED→closed，与微信同一套 reconcile 管线

## 代码结构

```
domains/payment/src/
  alipay/crypto.ts         RSA2 签名内容构造 + 签名/验签 + 时间戳
  config/alipay.ts         AlipayGatewayConfig
  gateways/alipay.ts       当面付下单 / 通知验签 / query / 同步 refund
apps/pay-mock-server/src/
  alipay.ts                假支付宝平台(验商户签名、gateway.do 分发、模拟支付/关闭、表单通知)
```

## 真实接入清单（支付宝开放平台资质到位后）

1. 开放平台创建应用，开通当面付；`ALIPAY_APP_ID` + 应用私钥（RSA2）配置到 `.env`，`ALIPAY_API_BASE` 切回 `https://openapi.alipay.com`
2. 支付宝公钥：开放平台密钥工具生成后，把支付宝公钥存到 `ALIPAY_PUBLIC_KEY_PATH`
3. `ALIPAY_NOTIFY_URL` 指向公网可达的 `/payments/notify/alipay`（需 HTTPS）
4. 验证金额字段、回调幂等、outbox worker 投递、退款与对账
