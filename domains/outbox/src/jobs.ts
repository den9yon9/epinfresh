export const OUTBOX_QUEUE_NAME = 'outbox-dispatch'

export const OUTBOX_JOB_NAMES = {
  DISPATCH: 'dispatch',
} as const

export const OUTBOX_POLL_INTERVAL_MS = 2000
