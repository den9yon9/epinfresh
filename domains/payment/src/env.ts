import { readFileSync } from 'node:fs'

import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

import { createPaymentGateways, type PaymentChannel, type PaymentGateway } from './gateway'

// 支付渠道配置的单一来源: storefront-api / admin-api / worker 三个进程都要建网关注册表,
// 为避免三处重复解析/校验/读 PEM, 集中在此。应用侧 env.ts 只管各自业务字段。
export const paymentEnvSchema = Type.Object({
  // 渠道注册表开关: mock 是"无加密快速通道"(e2e 依赖); wechat 走 APIv3 网关
  PAYMENT_GATEWAY: Type.Union([Type.Literal('mock'), Type.Literal('wechat')], {
    default: 'mock',
  }),
  // 渠道端点: 真实 https://api.mch.weixin.qq.com; 联调期指向本地 pay-mock-server
  WECHAT_API_BASE: Type.String({ default: 'https://api.mch.weixin.qq.com' }),
  WECHAT_MERCHANT_ID: Type.String({ default: '' }),
  WECHAT_APP_ID: Type.String({ default: '' }),
  // APIv3 密钥(32 字节), 用于回调资源解密
  WECHAT_API_V3_KEY: Type.String({ default: '' }),
  WECHAT_MERCHANT_SERIAL_NO: Type.String({ default: '' }),
  // 商户私钥 / 平台公钥 PEM 文件路径(网关按路径读入)
  WECHAT_MERCHANT_PRIVATE_KEY_PATH: Type.String({ default: '' }),
  WECHAT_PLATFORM_PUBLIC_KEY_PATH: Type.String({ default: '' }),
  WECHAT_NOTIFY_URL: Type.String({ default: '' }),
})

export type PaymentEnv = StaticDecode<typeof paymentEnvSchema>

// 从原始环境变量源构建网关注册表; PAYMENT_GATEWAY=wechat 时校验并读取 PEM。
// 校验失败即抛错(进程启动即失败, 与 storefront-api 旧行为一致)。
export function createPaymentGatewaysFromEnv(
  source: Record<string, string | undefined>,
): Record<PaymentChannel, PaymentGateway> {
  const env = parseEnv(paymentEnvSchema, source)
  if (env.PAYMENT_GATEWAY === 'wechat') {
    const required = [
      env.WECHAT_MERCHANT_ID,
      env.WECHAT_APP_ID,
      env.WECHAT_API_V3_KEY,
      env.WECHAT_MERCHANT_SERIAL_NO,
      env.WECHAT_MERCHANT_PRIVATE_KEY_PATH,
      env.WECHAT_PLATFORM_PUBLIC_KEY_PATH,
      env.WECHAT_NOTIFY_URL,
    ] as const
    if (required.some((v) => !v)) {
      throw new Error('[ENV] PAYMENT_GATEWAY=wechat requires all WECHAT_* variables')
    }
    if (env.WECHAT_API_V3_KEY.length !== 32) {
      throw new Error('[ENV] WECHAT_API_V3_KEY must be exactly 32 bytes')
    }
  }

  if (env.PAYMENT_GATEWAY === 'wechat') {
    return createPaymentGateways([
      {
        channel: 'wechat',
        config: {
          baseUrl: env.WECHAT_API_BASE,
          merchantId: env.WECHAT_MERCHANT_ID,
          appId: env.WECHAT_APP_ID,
          apiV3Key: env.WECHAT_API_V3_KEY,
          merchantSerialNo: env.WECHAT_MERCHANT_SERIAL_NO,
          merchantPrivateKey: readFileSync(env.WECHAT_MERCHANT_PRIVATE_KEY_PATH, 'utf8'),
          platformPublicKey: readFileSync(env.WECHAT_PLATFORM_PUBLIC_KEY_PATH, 'utf8'),
          notifyUrl: env.WECHAT_NOTIFY_URL,
        },
      },
    ])
  }
  return createPaymentGateways([{ channel: 'mock' }])
}
