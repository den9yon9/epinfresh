# 微信支付 Native 接入与本地模拟器

## 背景

微信支付没有官方沙箱环境，所以仓库里提供了一个**本地微信支付模拟器** `apps/pay-mock-server`，作为开发/CI 的 de-facto 沙箱长期保留。它模拟微信服务端行为：

- 校验商户出站请求的 `WECHATPAY2-SHA256-RSA2048` 签名（含 5 分钟时间窗）
- 返回 Native 下单结果（`prepay_id` + `weixin://wxpay/bizpayurl?pr=…`）
- 提供 `/v3/certificates`（加密返回假平台公钥，供运行时拉取公钥的链路测试）
- 构造"支付成功"回调：资源按 APIv3 AES-256-GCM 加密、整包按假平台私钥签名，投递到通知地址

与真实微信的差异仅在于密钥来源：接受本地生成的商户签名、用本地假平台密钥签发回调。将来支付宝 mock 复用同一套"假平台签名"模式（`src/alipay.ts`）。

## 双轴配置

支付接入由两个独立开关控制，可任意组合：

| 轴   | 变量              | 说明                                                                  |
| ---- | ----------------- | --------------------------------------------------------------------- |
| 渠道 | `PAYMENT_GATEWAY` | `mock`（本地无加密快速通道，e2e 依赖）/ `wechat`                      |
| 端点 | `WECHAT_API_BASE` | 真实 `https://api.mch.weixin.qq.com` / 模拟器 `http://localhost:8787` |

其余 `WECHAT_*`（商户号/证书/密钥路径/回调地址）只在 `PAYMENT_GATEWAY=wechat` 时必需，`createEnv` 会运行时校验。

前端渠道由构建环境 `VITE_PAYMENT_CHANNEL` 决定（默认 `mock`），写入 `apps/storefront-web/.env` 即可切到 `wechat`。

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
```

`out_trade_no` 可从 storefront-api 的支付单列表接口拿到（`/orders/:id/payments`）。

## 代码结构

```
domains/payment/src/
  wechat/crypto.ts        RSA 签名/验签、Authorization 头构造、防重放、AES-256-GCM 加解密
  config/wechat.ts        WechatGatewayConfig(密钥以 PEM 内容传入, 由调用方读文件)
  gateways/wechat.ts      统一下单、回调验签+解密→WebhookEvent、/v3/certificates 公钥拉取
apps/pay-mock-server/
  src/wechat.ts           假微信服务端(验商户签名、模拟下单/证书/回调构造)
  src/server.ts           Bun.serve 路由装配
  src/cli.ts              dev 入口
```

## 真实接入清单（商户号到位后）

1. 商户号 + APIv3 密钥 + APIv3 证书（serial_no 与私钥）配置到 `.env`，`WECHAT_API_BASE` 切回 `https://api.mch.weixin.qq.com`
2. 平台公钥：联调期从模拟器 `/v3/certificates` 拉取（`fetchWechatPlatformPublicKey`）；真实环境同样在商户初始化后拉取并做证书轮换
3. `WECHAT_NOTIFY_URL` 指向公网可达的 `/payments/notify/wechat`（微信要求 HTTPS）
4. Native 需使用真实商户号绑定的小程序/公众号 appid 参与签名校验（simulate 的 appid 目前不校验）
5. 验证金额字段、回调幂等、outbox worker 投递

## 密码学要点

- 出站请求签名串：`{method}\n{canonicalUrl}\n{timestamp}\n{nonce}\n{body}\n`，RSA-SHA256 后 base64 放入 `Authorization`
- 回调验签串：`{timestamp}\n{nonce}\n{body}\n`，用平台公钥 RSA-SHA256 验签，时间窗 5 分钟防重放
- 回调 `resource` 用 APIv3 密钥 AES-256-GCM 解密（密文尾部 16 字节为 auth tag），解密后再做金额等业务校验
- 金额以分为单位传给微信；回调金额与支付单不符一律拒绝（防伪造回调）
