export const MAINTENANCE_QUEUE_NAME = 'maintenance-tasks'

export const MAINTENANCE_JOB_NAMES = {
  PRUNE_IDEMPOTENCY_KEYS: 'prune-idempotency-keys',
} as const

export const IDEMPOTENCY_KEY_RETENTION_DAYS = 90

export interface PruneIdempotencyKeysJobData {
  requestId?: string
}
