import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

const corsOrigin = Type.Transform(Type.String({ default: '*' }))
  .Decode((raw: string) => {
    const s = raw.trim()
    if (s === '*') return true
    const list = s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    if (list.length === 0) return true
    if (list.length === 1) return list[0] as string
    return list
  })
  .Encode((v) => (typeof v === 'boolean' ? '*' : Array.isArray(v) ? v.join(',') : v))

const trustProxy = Type.Transform(Type.String({ default: 'false' }))
  .Decode((raw: string) => raw.trim() === 'true')
  .Encode((v) => (v ? 'true' : 'false'))

export const storefrontEnvSchema = Type.Object({
  DATABASE_URL: Type.String({ format: 'uri' }),
  REDIS_URL: Type.String({ format: 'uri' }),
  SESSION_SECRET: Type.String({ minLength: 32 }),
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    {
      default: 'development',
    },
  ),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('debug'),
      Type.Literal('info'),
      Type.Literal('warn'),
      Type.Literal('error'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  CORS_ORIGIN: corsOrigin,
  TRUST_PROXY: trustProxy,
  STOREFRONT_PORT: Type.String({ pattern: '^\\d+$' }),
  // 支付渠道注册表开关: 当前 mock 已实现; wechat 在 M3 接入
  PAYMENT_GATEWAY: Type.Union([Type.Literal('mock'), Type.Literal('wechat')], {
    default: 'mock',
  }),
  // --- 微信支付 APIv3(仅 PAYMENT_GATEWAY=wechat 时必需, 由 createEnv 运行时校验) ---
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

export type StorefrontEnv = StaticDecode<typeof storefrontEnvSchema>

export function createEnv(source: Record<string, string | undefined> = process.env): StorefrontEnv {
  const env = parseEnv(storefrontEnvSchema, source)
  if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === true) {
    throw new Error(
      '[ENV] CORS_ORIGIN cannot be "*" in production; set an explicit origin or comma-separated allowlist',
    )
  }
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
  return env
}
