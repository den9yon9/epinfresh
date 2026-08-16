# 支付流程（Payment Flow）

> M1 落地形态：渠道无关核心 + 渠道注册表 + mock 全链路。真实微信/支付宝网关在后续里程碑接入。
> 相关代码：`domains/payment`、`usecases/payment-confirm`、`apps/storefront-api/src/routes/payment.ts`。

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
    Deps["deps: createPaymentGateways(configs)"] --> Mock[mock: createMockPaymentGateway]
    Deps --> Wechat[wechat: 未实现<br/>M3 接入]
    Deps --> Alipay[alipay: 未实现<br/>M4 接入]
    Mock --> Core[支付核心<br/>零渠道逻辑]
    Wechat --> Core
    Alipay --> Core
    Core --> Ctx[channelContext 不透明透传<br/>如微信 JSAPI 的 openid]
    Ctx -. 网关层消费 .-> Wechat
```

> 核心（`domains/payment`）不感知任何渠道特有概念（openid、UA、公众号）；
> 前端按 channel 发起，路由按 channel 分发回调，加新渠道 = 注册表一项 + 前端一个支付方式选项。

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
- **迁移**：`packages/database/src/migrations/0013_pretty_thena.sql` 加 `out_trade_no`（存量 backfill）、`provider_transaction_id` + 部分唯一索引、`payload jsonb`。
