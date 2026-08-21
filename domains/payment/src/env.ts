import { readFileSync } from 'node:fs'

import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

import {
  createPaymentGateways,
  type PaymentChannel,
  type PaymentGateway,
  type PaymentGatewayConfig,
} from './gateway'

const VALID_CHANNELS = ['mock', 'wechat', 'alipay'] as const

// 支付渠道列表: 逗号分隔多值(如 "wechat,alipay"), 一个部署可同时提供多个渠道
const paymentGatewayList = Type.Transform(Type.String({ default: 'mock' }))
  .Decode((raw: string): PaymentChannel[] => {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const channel of list) {
      if (!(VALID_CHANNELS as readonly string[]).includes(channel)) {
        throw new Error(`[ENV] invalid PAYMENT_GATEWAY value: ${channel}`)
      }
    }
    return list as PaymentChannel[]
  })
  .Encode((v: string[]) => v.join(','))

// 支付渠道配置的单一来源: storefront-api / admin-api / worker 三个进程都要建网关注册表,
// 为避免三处重复解析/校验/读 PEM, 集中在此。应用侧 env.ts 只管各自业务字段。
export const paymentEnvSchema = Type.Object({
  // 渠道注册表开关: 逗号分隔(如 "wechat,alipay"); mock 是"无加密快速通道"(e2e 依赖)
  PAYMENT_GATEWAY: paymentGatewayList,
  // --- 微信支付 APIv3(仅含 wechat 时必需) ---
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
  // 公众号网页授权 + JS-SDK(仅含 wechat 且走 JSAPI 时必需); WECHAT_APP_ID 复用为 appid
  // authorize 走 open.weixin.qq.com; token/ticket/sns 走 api.weixin.qq.com(联调都指向 mock)
  WECHAT_OAUTH_BASE: Type.String({ default: 'https://open.weixin.qq.com' }),
  WECHAT_OAUTH_API_BASE: Type.String({ default: 'https://api.weixin.qq.com' }),
  WECHAT_APP_SECRET: Type.String({ default: '' }),
  // --- 支付宝(仅含 alipay 时必需) ---
  // 网关端点: 真实 https://openapi.alipay.com; 联调期指向本地 pay-mock-server
  ALIPAY_API_BASE: Type.String({ default: 'https://openapi.alipay.com' }),
  ALIPAY_APP_ID: Type.String({ default: '' }),
  // 应用私钥 / 支付宝公钥 PEM 文件路径(网关按路径读入)
  ALIPAY_APP_PRIVATE_KEY_PATH: Type.String({ default: '' }),
  ALIPAY_PUBLIC_KEY_PATH: Type.String({ default: '' }),
  ALIPAY_NOTIFY_URL: Type.String({ default: '' }),
})

export type PaymentEnv = StaticDecode<typeof paymentEnvSchema>

function requireAll(channel: string, values: readonly string[]) {
  if (values.some((v) => !v)) {
    throw new Error(`[ENV] PAYMENT_GATEWAY=${channel} requires all of its variables`)
  }
}

function buildConfigs(env: PaymentEnv): PaymentGatewayConfig[] {
  const configs: PaymentGatewayConfig[] = []
  for (const channel of env.PAYMENT_GATEWAY) {
    switch (channel) {
      case 'mock':
        configs.push({ channel: 'mock' })
        break
      case 'wechat':
        requireAll('wechat', [
          env.WECHAT_MERCHANT_ID,
          env.WECHAT_APP_ID,
          env.WECHAT_API_V3_KEY,
          env.WECHAT_MERCHANT_SERIAL_NO,
          env.WECHAT_MERCHANT_PRIVATE_KEY_PATH,
          env.WECHAT_PLATFORM_PUBLIC_KEY_PATH,
          env.WECHAT_NOTIFY_URL,
        ])
        if (env.WECHAT_API_V3_KEY.length !== 32) {
          throw new Error('[ENV] WECHAT_API_V3_KEY must be exactly 32 bytes')
        }
        configs.push({
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
        })
        break
      case 'alipay':
        requireAll('alipay', [
          env.ALIPAY_APP_ID,
          env.ALIPAY_APP_PRIVATE_KEY_PATH,
          env.ALIPAY_PUBLIC_KEY_PATH,
          env.ALIPAY_NOTIFY_URL,
        ])
        configs.push({
          channel: 'alipay',
          config: {
            baseUrl: env.ALIPAY_API_BASE,
            appId: env.ALIPAY_APP_ID,
            appPrivateKey: readFileSync(env.ALIPAY_APP_PRIVATE_KEY_PATH, 'utf8'),
            alipayPublicKey: readFileSync(env.ALIPAY_PUBLIC_KEY_PATH, 'utf8'),
            notifyUrl: env.ALIPAY_NOTIFY_URL,
          },
        })
        break
    }
  }
  return configs
}

// 从原始环境变量源构建网关注册表; 每个启用的渠道独立校验并读取 PEM。
// 校验失败即抛错(进程启动即失败)。
export function createPaymentGatewaysFromEnv(
  source: Record<string, string | undefined>,
): Record<PaymentChannel, PaymentGateway> {
  const env = parseEnv(paymentEnvSchema, source)
  return createPaymentGateways(buildConfigs(env))
}
