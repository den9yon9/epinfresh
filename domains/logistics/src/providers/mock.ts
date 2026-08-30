import { ok, type Result } from '@epinfresh/shared'

import type { TrackQueryInput, TrackSnapshot } from '../model'
import type { LogisticsProvider } from '../model'

// 事件在发货后按固定节奏推进: 揽收(0) → 转运(1/3) → 派送(2/3) → 签收(窗口末)。
// deliverAfterMs 由 env 注入(默认 180 分钟; e2e 置 0 = 发货即签收)。
export function createMockLogisticsProvider(deliverAfterMs: number): LogisticsProvider {
  return {
    async queryTrack(input: TrackQueryInput): Promise<Result<TrackSnapshot, 'PROVIDER_ERROR'>> {
      const { company, trackingNumber, shippedAt, now } = input
      const elapsed = now.getTime() - shippedAt.getTime()
      const at = (fraction: number) => new Date(shippedAt.getTime() + deliverAfterMs * fraction)

      const stages: {
        at: number
        time: Date
        status: 'collected' | 'in_transit' | 'out_for_delivery' | 'delivered'
        desc: string
      }[] = [
        { at: 0, time: at(0), status: 'collected', desc: '快件已被揽收' },
        { at: 1 / 3, time: at(1 / 3), status: 'in_transit', desc: '快件到达转运中心, 正在中转' },
        { at: 2 / 3, time: at(2 / 3), status: 'out_for_delivery', desc: '快件正在派送中' },
        {
          at: 1,
          time: at(1),
          status: 'delivered',
          desc: '快件已签收, 感谢使用, 期待再次为您服务',
        },
      ]

      // 尚未发生的事件(时间在未来)不进快照; 状态取最后一个已发生事件
      const happened = stages.filter((s) => elapsed >= s.at * deliverAfterMs)
      const events = happened.map((s) => ({
        time: s.time.toISOString(),
        status: s.status,
        desc: `[${company}/${trackingNumber}] ${s.desc}`,
      }))
      const last = happened[happened.length - 1]
      const delivered = last?.status === 'delivered'

      return ok({
        events,
        status: last?.status ?? 'collected',
        delivered,
        deliveredAt: delivered ? last.time.toISOString() : null,
      })
    },
  }
}
