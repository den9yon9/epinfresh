# 支付流程（Payment Flow）

> 当前形态：渠道无关核心 + 渠道注册表 + 三渠道已实现（mock 本地沙箱 / wechat APIv3 / alipay RSA2）。
> 相关代码：`domains/payment`、`usecases/payment-confirm`、`usecases/payment-refund`、`apps/storefront-api/src/routes/payment.ts`。

## 发起支付 → 支付确认 主链路

```mermaid
flowchart TD
    Start([用户点「确认支付」]) --> Pay["POST /orders/:id/pay<br/>body: { channel, channelContext? }"]

    Pay --> Registry{"paymentGateways[channel]<br/>注册表取网关"}
    Registry -- 未配置 --> Err400[400 PAYMENT_CHANNEL_NOT_CONFIGURED]
    Registry -- 命中 --> Init[initiatePayment]

    Init --> Check{订单校验}
    Check -- 不存在 --> Err404[404 ORDER_NOT_FOUND]
    Check -- 非 pending --> Err409[409 ORDER_NOT_PENDING]
    Check -- pending --> Reuse{pending 支付单<br/>且 payload 已存在?}
    Reuse -- 是 --> ReturnOld[直接复用返回旧支付单]
    Reuse -- 否 --> Insert["生成 outTradeNo 32位<br/>先落库 payments{pending, provider=channel}"]
    Insert --> Create["gateway.createPayment<br/>{outTradeNo, 金额, description, channelContext}"]
    Create -- 失败 --> Fail[payments 标 failed] --> Err502[502 GATEWAY_ERROR]
    Create -- 成功 --> Backfill[回填 providerRef + payload]
    Backfill --> Resp201["201 { payment, payload }"]

    Resp201 --> Payload{payload.type}
    Payload -- qr --> Qr[扫码展示 codeUrl]
    Payload -- redirect --> Redirect[跳转支付 URL]
    Payload -- params --> Params[渠道内拉起参数<br/>JSAPI/H5]
    Qr & Redirect & Params --> Wait([用户在渠道平台完成支付])

    Wait --> MockConfirm{渠道}
    MockConfirm -- mock 确认端点 --> Synth[合成 WebhookEvent<br/>POST /payments/:id/confirm 走同一管线]
    MockConfirm -- 真实渠道回调 --> Notify[POST /payments/notify/:channel<br/>公共入口, 无登录]

    Synth --> Verify[gateway.verifyWebhook<br/>headers + rawBody]
    Notify --> Verify
    Verify -- 验签失败 --> Fail400[400 'FAIL'<br/>渠道稍后重试]

    Verify -- 验签通过 --> CWE[confirmByWebhookEvent]
    CWE --> Locate[定位: provider_transaction_id<br/>兜底 out_trade_no]
    Locate -- 未找到 --> Nf[404 PAYMENT_NOT_FOUND]
    Locate -- 已 succeeded --> Idem[直接返回, 幂等<br/>重复回调不报错]
    Locate -- pending --> Amount{金额比对<br/>event.amount === payment.amount?}
    Amount -- 不符 --> Mismatch[400 AMOUNT_MISMATCH<br/>防伪造回调]
    Amount -- 一致 --> TxId[回填 provider_transaction_id]
    TxId --> Confirm[confirmOrderPayment<br/>withTransaction CAS]
    Confirm --> PUpdate[payments pending → succeeded]
    Confirm --> OUpdate[orders pending → paid]
    Confirm -- 并发重复回调 --> Recheck[重查已 succeeded? 视为幂等成功]
```

## 渠道注册表（不绑死任何支付平台）

```mermaid
flowchart LR
    Deps["deps: createPaymentGatewaysFromEnv(source)"] --> Mock[mock: createMockPaymentGateway]
    Deps --> Wechat[wechat: createWechatPaymentGateway<br/>APIv3 签名/验签 + AES-GCM]
    Deps --> Alipay[alipay: createAlipayPaymentGateway<br/>RSA2 签名/验签]
    Mock --> Core[支付核心<br/>零渠道逻辑]
    Wechat --> Core
    Alipay --> Core
    Core --> Ctx[channelContext 不透明透传<br/>如微信 JSAPI 的 openid]
    Ctx -. 网关层消费 .-> Wechat
```

> 核心（`domains/payment`）不感知任何渠道特有概念（openid、UA、公众号）；
> 前端按 channel 发起，路由按 channel 分发回调，加新渠道 = 注册表一项 + 前端一个支付方式选项。
> 支付配置（`PAYMENT_GATEWAY` + 各渠道 `*_API_BASE`/密钥路径）由 `createPaymentGatewaysFromEnv`
> 统一解析/校验/读 PEM，storefront-api / admin-api / worker 三进程同一来源。
> `PAYMENT_GATEWAY` 支持**逗号分隔多值**（如 `wechat,alipay`），一个部署可同时提供多个渠道；
> 前端 `VITE_PAYMENT_CHANNEL` 提供候选渠道列表，并按**运行环境过滤**（微信内置浏览器只展示微信支付、支付宝内置浏览器只展示支付宝）。

## 渠道网关能力

| 渠道   | 下单                | 回调验签                | 查询(queryPayment)       | 退款(refund)              | 退款查询(refundQuery)     |
| ------ | ------------------- | ----------------------- | ------------------------ | ------------------------- | ------------------------- |
| mock   | 同步返回 qr         | 不支持(走本地确认端点)  | 无(无外部真值, 对账跳过) | 同步成功                  | 无(跳过)                  |
| wechat | APIv3 native        | 平台签名 + AES-GCM 解密 | GET 交易查询             | /v3/refund(异步结果)      | GET refunds/{no}          |
| alipay | 当面付 precreate→qr | RSA2 验签(表单 notify)  | alipay.trade.query       | alipay.trade.refund(同步) | alipay.trade.refund.query |

- **对账**：worker 每 5 分钟扫超 30 分钟 pending 的支付单，`queryPayment` 渠道侧 paid→走幂等确认管线、closed→取消支付单；mock 跳过。
- **退款对账**：同任务扫超 30 分钟仍 processing 的退款单，`refundQuery` 渠道侧 succeeded→走退款通知确认管线、abnormal→标异常；mock 跳过（退款通知丢失兜底）。
- **退款**：`refundOrderWorkflow` 先渠道后本地（确定性退款号 `rf-{paymentId}` 保证重试幂等）；渠道失败不改本地。异步渠道（微信）提交后落**退款单 processing**，订单/支付单保持不动，由**退款通知**驱动终态（见下）。退款通知**金额比对**与支付确认同标准（不符即拒绝，渠道重试）。退款单 **abnormal 后自动换新号重试**（`rf-{paymentId}-{n}`）。

## 退款（异步两段式）

真实渠道（微信）退款是异步的，`refunds` 表记录退款单生命周期：

```mermaid
flowchart LR
    Submit["退款提交<br/>(admin 退款 / 取消已支付订单)"] --> Gw{渠道返回}
    Gw -- succeeded<br/>(mock/支付宝) --> Sync["事务内翻转<br/>订单 refunded + 支付单 refunded<br/>+ 退款单 succeeded"]
    Gw -- processing<br/>(微信) --> P[退款单 processing<br/>订单/支付单保持不动]
    P --> Notify{退款通知<br/>REFUND.SUCCESS / ABNORMAL}
    Notify -- SUCCESS --> S["退款单 succeeded<br/>+ 支付单 refunded<br/>+ 订单 refunded(已取消则跳过)"]
    Notify -- ABNORMAL --> A[退款单 abnormal<br/>不翻转任何状态]
```

- 重复提交防护：`out_refund_no` 唯一（确定性派生 `rf-{paymentId}`），已存在退款单直接 409
- 退款通知与支付通知共用 `/payments/notify/:channel` 入口，验签后由 `confirmByWebhookEvent` 分发到 `confirmRefundByWebhookEvent`
- 幂等：退款单/支付单已终态直接返回；未知退款单确认消费（对账兜底）

## 状态机

```mermaid
stateDiagram-v2
    [*] --> pending: initiatePayment 落库
    pending --> succeeded: webhook/confirm 确认
    pending --> failed: 下单/渠道失败
    pending --> cancelled: 订单取消
    succeeded --> refunded: 退款
    failed --> [*]
    cancelled --> [*]
    refunded --> [*]
```

## 关键设计点

- **幂等**：重复发起复用 pending 单；重复回调/重复确认直接返回，不重复推进订单。
- **金额防伪**：webhook 事件金额与支付单不符即拒绝（`AMOUNT_MISMATCH`）。
- **事务边界**：`confirmByWebhookEvent` 的定位/校验在事务外（只读+单语句原子），状态推进复用 `confirmOrderPayment` 自带事务，避免嵌套 `withTransaction`。
- **迁移**：`0013_pretty_thena.sql` 加 `out_trade_no`（存量 backfill）、`provider_transaction_id` + 部分唯一索引、`payload jsonb`；`0016_refunds_table.sql` 加 `refunds` 退款单表（异步退款状态机，含 `out_refund_no` 唯一 + `payment_id` 索引）。
