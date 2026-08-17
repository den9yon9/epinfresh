import { readFileSync } from 'node:fs'

import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

export const payMockEnvSchema = Type.Object({
  PAY_MOCK_PORT: Type.String({ pattern: '^\\d+$', default: '8787' }),
  PAY_MOCK_MERCHANT_ID: Type.String(),
  PAY_MOCK_APP_ID: Type.String(),
  // APIv3 密钥(32 字节), 用于加密模拟回调资源
  PAY_MOCK_API_V3_KEY: Type.String({ minLength: 32, maxLength: 32 }),
  // 商户私钥(PEM 文件路径): 模拟器据此派生公钥, 校验网关出站请求签名
  PAY_MOCK_MERCHANT_PRIVATE_KEY_PATH: Type.String(),
  // 假平台私钥(PEM 文件路径): 模拟器用它签回调
  PAY_MOCK_PLATFORM_PRIVATE_KEY_PATH: Type.String(),
  PAY_MOCK_PLATFORM_SERIAL_NO: Type.String(),
  // 模拟支付完成时回调的目标(真实对接时指向 storefront-api 的 /payments/notify/wechat)
  PAY_MOCK_NOTIFY_URL: Type.String({ format: 'uri' }),
})

export type PayMockEnv = StaticDecode<typeof payMockEnvSchema>

export interface PayMockServerConfig {
  port: number
  merchantId: string
  appId: string
  apiV3Key: string
  // PEM 内容(由调用方从文件读入; 测试可直接传内存密钥)
  merchantPrivateKey: string
  platformPrivateKey: string
  platformSerialNo: string
  notifyUrl: string
}

function loadConfig(env: PayMockEnv): PayMockServerConfig {
  return {
    port: Number(env.PAY_MOCK_PORT),
    merchantId: env.PAY_MOCK_MERCHANT_ID,
    appId: env.PAY_MOCK_APP_ID,
    apiV3Key: env.PAY_MOCK_API_V3_KEY,
    merchantPrivateKey: readFileSync(env.PAY_MOCK_MERCHANT_PRIVATE_KEY_PATH, 'utf8'),
    platformPrivateKey: readFileSync(env.PAY_MOCK_PLATFORM_PRIVATE_KEY_PATH, 'utf8'),
    platformSerialNo: env.PAY_MOCK_PLATFORM_SERIAL_NO,
    notifyUrl: env.PAY_MOCK_NOTIFY_URL,
  }
}

export function createConfig(source: Record<string, string | undefined> = process.env) {
  return loadConfig(parseEnv(payMockEnvSchema, source))
}
