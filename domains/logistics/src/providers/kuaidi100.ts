import { createHash } from 'node:crypto'

import { err, ok, type Result } from '@epinfresh/shared'

import type { LogisticsProvider, TrackEvent, TrackQueryInput, TrackSnapshot } from '../model'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface Kuaidi100Config {
  customer: string
  key: string
  apiBase?: string
  // 可注入自定义 fetch 便于测试与 mock 响应
  fetchFn?: FetchLike
}

export interface Kuaidi100EventItem {
  time: string
  ftime?: string
  context: string
  status?: string
}

export interface Kuaidi100QueryResponse {
  message?: string
  state?: string
  status?: string
  condition?: string
  ischeck?: string
  com?: string
  nu?: string
  data?: Kuaidi100EventItem[]
}

const COMPANY_CODE_MAP: Record<string, string> = {
  sf: 'shunfeng',
  zto: 'zhongtong',
  yto: 'yuantong',
  jd: 'jd',
  ems: 'ems',
}

export function toKuaidi100Company(company: string): string {
  return COMPANY_CODE_MAP[company] ?? company
}

export function signKuaidi100(param: string, key: string, customer: string): string {
  return createHash('md5')
    .update(param + key + customer, 'utf8')
    .digest('hex')
    .toUpperCase()
}

// 快递100 state 映射为系统内部的 LogisticsTrackStatus
export function mapKuaidi100State(state?: string): TrackSnapshot['status'] {
  switch (state) {
    case '1':
      return 'collected'
    case '5':
      return 'out_for_delivery'
    case '3':
      return 'delivered'
    case '2':
    case '13':
      return 'delivery_failed'
    case '4':
    case '6':
    case '14':
      return 'rejected'
    case '0':
    case '7':
    case '10':
    case '11':
    case '12':
    default:
      return 'in_transit'
  }
}

export function inferEventStatus(
  desc: string,
  trackStatus: TrackSnapshot['status'],
): TrackEvent['status'] {
  if (desc.includes('签收') || desc.includes('已投递')) return 'delivered'
  if (desc.includes('拒收') || desc.includes('退回')) return 'rejected'
  if (desc.includes('失败') || desc.includes('异常') || desc.includes('无法送达')) {
    return 'delivery_failed'
  }
  if (desc.includes('派送') || desc.includes('派件')) return 'out_for_delivery'
  if (desc.includes('揽收') || desc.includes('收取') || desc.includes('已取件')) return 'collected'
  if (trackStatus !== 'pending') return trackStatus
  return 'in_transit'
}

function parseIsoTime(timeStr: string): string {
  const normalized = timeStr.replace(/-/g, '/')
  const d = new Date(normalized)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export function createKuaidi100LogisticsProvider(config: Kuaidi100Config): LogisticsProvider {
  return {
    async queryTrack(input: TrackQueryInput): Promise<Result<TrackSnapshot, 'PROVIDER_ERROR'>> {
      const com = toKuaidi100Company(input.company)
      const paramObj = {
        com,
        num: input.trackingNumber,
        resultv2: '1',
      }
      const param = JSON.stringify(paramObj)
      const sign = signKuaidi100(param, config.key, config.customer)

      const body = new URLSearchParams()
      body.set('customer', config.customer)
      body.set('sign', sign)
      body.set('param', param)

      const endpoint = config.apiBase ?? 'https://poll.kuaidi100.com/poll/query.do'
      const customFetch = config.fetchFn ?? fetch

      try {
        const response = await customFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        })

        if (!response.ok) {
          return err('PROVIDER_ERROR')
        }

        const data = (await response.json()) as Kuaidi100QueryResponse
        if (!data || data.status !== '200' || !Array.isArray(data.data)) {
          return err('PROVIDER_ERROR')
        }

        const status = mapKuaidi100State(data.state)
        const delivered = status === 'delivered'

        const rawEvents = data.data
        const events: TrackEvent[] = rawEvents.map((item) => {
          const time = parseIsoTime(item.time || item.ftime || '')
          const desc = `[${input.company}/${input.trackingNumber}] ${item.context}`
          const eventStatus = inferEventStatus(item.context, status)
          return { time, status: eventStatus, desc }
        })

        // 按时间升序排列
        events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

        const deliveredAt = delivered
          ? (events.findLast((e) => e.status === 'delivered')?.time ??
            events[events.length - 1]?.time ??
            null)
          : null

        return ok({
          events,
          status,
          delivered,
          deliveredAt,
        })
      } catch {
        return err('PROVIDER_ERROR')
      }
    },
  }
}
