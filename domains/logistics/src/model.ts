import { type LogisticsTrackEventData, type LogisticsTrackStatus } from '@epinfresh/database'
import { type Result } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

// --- 承运商: 注册表键 + orders.courier_company 列 ---
export const COURIER_COMPANIES = ['sf', 'zto', 'yto', 'jd', 'ems'] as const
export type CourierCompany = (typeof COURIER_COMPANIES)[number]

export const COURIER_COMPANY_LABELS: Record<CourierCompany, string> = {
  sf: '顺丰速运',
  zto: '中通快递',
  yto: '圆通速递',
  jd: '京东物流',
  ems: 'EMS',
}

// --- 轨迹快照(provider 契约的返回形状, 渠道无关) ---
export const TrackEventSchema = Type.Object({
  // ISO 8601 字符串(jsonb 友好)
  time: Type.String(),
  status: Type.Union([
    Type.Literal('collected'),
    Type.Literal('in_transit'),
    Type.Literal('out_for_delivery'),
    Type.Literal('delivered'),
    Type.Literal('delivery_failed'),
    Type.Literal('rejected'),
  ]),
  desc: Type.String(),
})
export type TrackEvent = StaticDecode<typeof TrackEventSchema>

export interface TrackSnapshot {
  events: TrackEvent[]
  status: LogisticsTrackStatus
  delivered: boolean
  deliveredAt: string | null
}

export interface TrackQueryInput {
  company: string
  trackingNumber: string
  // 发货时间: mock provider 以此为基准推进事件; 真实 provider 可忽略
  shippedAt: Date
  now: Date
}

// --- 承运商契约(镜像 payment 的 PaymentGateway 模式) ---
export interface LogisticsProvider {
  queryTrack(input: TrackQueryInput): Promise<Result<TrackSnapshot, 'PROVIDER_ERROR'>>
}

// --- 对外响应形状(C 端/admin 轨迹时间线) ---
export const LogisticsTrackResponseSchema = Type.Object({
  company: Type.String(),
  trackingNumber: Type.String(),
  status: Type.String(),
  events: Type.Array(TrackEventSchema),
  deliveredAt: Type.Union([Type.String(), Type.Null()]),
})
export type LogisticsTrackResponse = StaticDecode<typeof LogisticsTrackResponseSchema>

// jsonb events 列的读取收敛: 防御性校验后转类型化数组(镜像 payment 的 payload 收敛模式)
const EVENT_STATUSES = new Set<string>(['collected', 'in_transit', 'out_for_delivery', 'delivered'])

export function toTrackEvents(raw: unknown): LogisticsTrackEventData[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is LogisticsTrackEventData =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as LogisticsTrackEventData).time === 'string' &&
      typeof (e as LogisticsTrackEventData).desc === 'string' &&
      typeof (e as LogisticsTrackEventData).status === 'string' &&
      EVENT_STATUSES.has((e as LogisticsTrackEventData).status),
  )
}
