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
  // 认证接口限流(次/分钟): 注册/登录共用。默认 20 为生产风控口径;
  // e2e 并行 3 项目共享 IP, 由 playwright webServer 行内 env 注入放宽值
  AUTH_RATE_LIMIT_PER_MINUTE: Type.String({ pattern: '^\\d+$', default: '20' }),
  // 运费策略: 固定运费(元), 默认 '0.00' = 关闭
  SHIPPING_FLAT_FEE: Type.String({ default: '0.00' }),
  // 满额包邮阈值(元, 按商品合计计); 空 = 不启用包邮
  FREE_SHIPPING_THRESHOLD: Type.String({ default: '' }),
  // 偏远省份名单(逗号分隔, 订单地址 province 精确匹配): 不参与包邮并加收 SHIPPING_REMOTE_FEE
  SHIPPING_REMOTE_PROVINCES: Type.String({ default: '' }),
  // 偏远省份加收运费(元)
  SHIPPING_REMOTE_FEE: Type.String({ default: '0.00' }),
  // 首重克数(默认 1000)
  SHIPPING_WEIGHT_BASE_GRAMS: Type.String({ pattern: '^\\d+$', default: '1000' }),
  // 续重分段克数(默认 1000)
  SHIPPING_WEIGHT_ADDITIONAL_GRAMS: Type.String({ pattern: '^\\d+$', default: '1000' }),
  // 每续重分段加收运费(元)
  SHIPPING_WEIGHT_ADDITIONAL_FEE: Type.String({ default: '0.00' }),
})

export type StorefrontEnv = StaticDecode<typeof storefrontEnvSchema>

export function createEnv(source: Record<string, string | undefined> = process.env): StorefrontEnv {
  const env = parseEnv(storefrontEnvSchema, source)
  if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === true) {
    throw new Error(
      '[ENV] CORS_ORIGIN cannot be "*" in production; set an explicit origin or comma-separated allowlist',
    )
  }
  return env
}
