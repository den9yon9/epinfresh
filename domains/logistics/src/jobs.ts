export const LOGISTICS_QUEUE_NAME = 'logistics-poll'

export const LOGISTICS_JOB_NAMES = {
  POLL: 'poll',
} as const

// worker 轨迹轮询间隔; env LOGISTICS_POLL_INTERVAL_MS 可覆盖(e2e 置小)
export const LOGISTICS_POLL_INTERVAL_MS = 10 * 60 * 1000

// 发货超过该天数仍未签收 → 轮询时记 warn(超时未签收告警, 对接将来告警通道的钩子)。
// 注意与订单域 7 天自动完成窗口区分: 这是"异常即将发生"的预警, 前者是无确认兜底。
export const LOGISTICS_STALE_ALERT_DAYS = 5
