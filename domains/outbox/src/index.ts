export { type OutboxEventHandler } from './handlers'
export {
  claimOutboxBatch,
  completeOutboxEvent,
  failOutboxEvent,
  insertOutboxEvent,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STALE_THRESHOLD_MS,
  type OutboxEventInput,
  type OutboxEventRecord,
  resetStaleOutboxEvents,
} from './service'
