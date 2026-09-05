import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

import type { LogisticsProvider } from './model'
import { createKuaidi100LogisticsProvider } from './providers/kuaidi100'
import { createMockLogisticsProvider } from './providers/mock'

// 承运商注册表键(与 payment 的 PAYMENT_GATEWAY 同款约定)
export const LOGISTICS_PROVIDER = ['mock', 'kuaidi100'] as const
export type LogisticsProviderName = (typeof LOGISTICS_PROVIDER)[number]

export const logisticsEnvSchema = Type.Object({
  // 轨迹来源: mock = 本地事件生成器(无外部依赖); kuaidi100 = 真实聚合查询
  LOGISTICS_PROVIDER: Type.Union([Type.Literal('mock'), Type.Literal('kuaidi100')], {
    default: 'mock',
  }),
  // mock 轨迹从发货到签收的时长(分钟, 字符串数字); 0 = 发货即签收(e2e 用)
  LOGISTICS_MOCK_DELIVER_AFTER_MINUTES: Type.String({ pattern: '^\\d+$', default: '180' }),
  // 快递100 客户编号
  KUAIDI100_CUSTOMER: Type.Optional(Type.String()),
  // 快递100 授权 key
  KUAIDI100_KEY: Type.Optional(Type.String()),
  // 快递100 API 端点(可配置 mock 路由用于测试)
  KUAIDI100_API_BASE: Type.Optional(Type.String({ format: 'uri' })),
})

export type LogisticsEnv = StaticDecode<typeof logisticsEnvSchema>

export function parseLogisticsEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv(logisticsEnvSchema, source)
}

// provider 注册表: 同一来源构建(storefront/admin-api 展示与 worker 轮询一致)
export function createLogisticsProviderFromEnv(
  source: Record<string, string | undefined> = process.env,
): LogisticsProvider {
  const env = parseLogisticsEnv(source)
  switch (env.LOGISTICS_PROVIDER) {
    case 'mock':
      return createMockLogisticsProvider(
        Number(env.LOGISTICS_MOCK_DELIVER_AFTER_MINUTES) * 60 * 1000,
      )
    case 'kuaidi100':
      if (!env.KUAIDI100_CUSTOMER || !env.KUAIDI100_KEY) {
        throw new Error(
          '[logistics] KUAIDI100_CUSTOMER and KUAIDI100_KEY are required when LOGISTICS_PROVIDER=kuaidi100',
        )
      }
      return createKuaidi100LogisticsProvider({
        customer: env.KUAIDI100_CUSTOMER,
        key: env.KUAIDI100_KEY,
        apiBase: env.KUAIDI100_API_BASE,
      })
  }
}
