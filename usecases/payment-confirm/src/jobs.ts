// 对账任务常量: worker 的 payment-reconcile worker 引用(与 checkout/jobs.ts 同模式)
export const RECONCILE_QUEUE_NAME = 'payment-reconcile-tasks'

export const RECONCILE_JOB_NAMES = {
  RUN: 'run-reconciliation',
} as const

// 对账频率与扫描门槛: 每 5 分钟扫一次, 创建超 30 分钟仍 pending 的支付单
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000
export const RECONCILE_STALE_AFTER_MS = 30 * 60 * 1000

export interface ReconcileJobData {
  requestId?: string
}
