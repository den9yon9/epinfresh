/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 支付渠道(与网关契约 PaymentChannel 一致): mock | wechat; 默认 mock
  readonly VITE_PAYMENT_CHANNEL?: 'mock' | 'wechat'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
