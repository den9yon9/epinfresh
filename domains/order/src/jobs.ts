// 队列契约: worker(app 层)注册消费者, 任务挂在 maintenance 队列上
export const ORDER_MAINTENANCE_JOB_NAMES = {
  AUTO_COMPLETE: 'order-auto-complete',
} as const

// 发货后超过该天数用户仍未确认收货, 由 worker 自动完成(生鲜保质期短, 7 天为行业常见默认)
export const ORDER_AUTO_COMPLETE_AFTER_DAYS = 7

// 每日 04:00 UTC 自动完成扫描, 与幂等键清理(03:00)错峰
export const ORDER_AUTO_COMPLETE_CRON = '0 4 * * *'
