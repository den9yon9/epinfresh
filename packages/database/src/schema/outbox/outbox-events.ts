import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const OUTBOX_EVENT_STATUS = ['pending', 'processing', 'completed', 'failed'] as const
export type OutboxEventStatus = (typeof OUTBOX_EVENT_STATUS)[number]

export const outboxEventStatus = pgEnum('outbox_event_status', OUTBOX_EVENT_STATUS)

// 事务内写出的领域事件, worker 异步投递(Outbox 模式)。
// aggregate_id 为多态引用(支付单/订单…), 不加外键。
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 32 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxEventStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    dispatchIdx: index('outbox_events_dispatch_idx').on(t.status, t.nextRetryAt, t.createdAt),
  }),
)
