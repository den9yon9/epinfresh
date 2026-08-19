/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 支付渠道(与网关契约 PaymentChannel 一致), 逗号分隔多值: mock | wechat | alipay; 默认 mock
  readonly VITE_PAYMENT_CHANNEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
