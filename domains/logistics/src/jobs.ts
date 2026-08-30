export const LOGISTICS_QUEUE_NAME = 'logistics-poll'

export const LOGISTICS_JOB_NAMES = {
  POLL: 'poll',
} as const

// worker 轨迹轮询间隔; env LOGISTICS_POLL_INTERVAL_MS 可覆盖(e2e 置小)
export const LOGISTICS_POLL_INTERVAL_MS = 10 * 60 * 1000
