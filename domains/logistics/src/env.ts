import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

import type { LogisticsProvider } from './model'
import { createMockLogisticsProvider } from './providers/mock'

// 承运商注册表键(与 payment 的 PAYMENT_GATEWAY 同款约定)
export const LOGISTICS_PROVIDER = ['mock', 'kuaidi100'] as const
export type LogisticsProviderName = (typeof LOGISTICS_PROVIDER)[number]

export const logisticsEnvSchema = Type.Object({
  // 轨迹来源: mock = 本地事件生成器(无外部依赖); kuaidi100 = 真实聚合查询(待接入)
  LOGISTICS_PROVIDER: Type.Union([Type.Literal('mock'), Type.Literal('kuaidi100')], {
    default: 'mock',
  }),
  // mock 轨迹从发货到签收的时长(分钟, 字符串数字); 0 = 发货即签收(e2e 用)
  LOGISTICS_MOCK_DELIVER_AFTER_MINUTES: Type.String({ pattern: '^\\d+$', default: '180' }),
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
      // 接入条件: 快递100 账号 + API key; 届时在此补实现, 调用方零改动
      throw new Error('[logistics] kuaidi100 provider not implemented yet; use mock')
  }
}
