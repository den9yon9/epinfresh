import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

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
  // 支付宝模拟器 AppID(与支付宝网关同 app 标识, 复用上述商户/平台密钥对)
  PAY_MOCK_ALIPAY_APP_ID: Type.String({ default: 'mock-alipay-app' }),
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
  // 支付宝模拟器 AppID
  alipayAppId?: string
}

// 密钥路径以仓库根为基准解析: 包脚本(turbo/pnpm)的 CWD 是 apps/pay-mock-server/,
// 而 .env 里的 keys/... 是相对仓库根写的——不修正的话相对路径永远指向不存在的
// apps/pay-mock-server/keys/。绝对路径原样保留。
const REPO_ROOT = resolve(import.meta.dir, '../../..')

function readKeyFile(envPath: string): string {
  const abs = isAbsolute(envPath) ? envPath : resolve(REPO_ROOT, envPath)
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    // 裸 ENOENT 对使用者毫无指向性: 指明生成密钥的命令
    throw new Error(
      `[pay-mock-server] 密钥文件不存在: ${abs}\n先在仓库根运行 pnpm keys:pay 生成密钥对`,
    )
  }
}

function loadConfig(env: PayMockEnv): PayMockServerConfig {
  return {
    port: Number(env.PAY_MOCK_PORT),
    merchantId: env.PAY_MOCK_MERCHANT_ID,
    appId: env.PAY_MOCK_APP_ID,
    apiV3Key: env.PAY_MOCK_API_V3_KEY,
    merchantPrivateKey: readKeyFile(env.PAY_MOCK_MERCHANT_PRIVATE_KEY_PATH),
    platformPrivateKey: readKeyFile(env.PAY_MOCK_PLATFORM_PRIVATE_KEY_PATH),
    platformSerialNo: env.PAY_MOCK_PLATFORM_SERIAL_NO,
    notifyUrl: env.PAY_MOCK_NOTIFY_URL,
    alipayAppId: env.PAY_MOCK_ALIPAY_APP_ID,
  }
}

export function createConfig(source: Record<string, string | undefined> = process.env) {
  return loadConfig(parseEnv(payMockEnvSchema, source))
}
