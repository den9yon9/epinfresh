import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { sendPaymentSucceededEmail } from '@epinfresh/notifications'
import type { OutboxEventHandler } from '@epinfresh/outbox'
import {
  claimOutboxBatch,
  insertOutboxEvent,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STALE_THRESHOLD_MS,
} from '@epinfresh/outbox'
import { createLogger } from '@epinfresh/shared'
import type { SendEmailJobData } from '@epinfresh/user/jobs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { dispatchOutbox } from './outboxWorker'

let db: Db
const logger = createLogger('silent')

beforeAll(async () => {
  db = await prepareTestDb()
})

afterAll(async () => {
  if (db) await closeDb(db)
})

beforeEach(async () => {
  await resetDb(db)
})

async function seedEvent(eventType = 'payment.succeeded') {
  await insertOutboxEvent(db, {
    eventType,
    aggregateType: 'payment',
    aggregateId: crypto.randomUUID(),
    payload: { orderId: 'order-1', amount: '25.00' },
  })
}

describe('dispatchOutbox', () => {
  test('dispatches a registered event and marks it completed', async () => {
    await seedEvent()
    const seen: unknown[] = []
    const handlers: Record<string, OutboxEventHandler> = {
      'payment.succeeded': (event) => {
        seen.push(event)
      },
    }

    await dispatchOutbox(db, logger, handlers)

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('completed')
    expect(row.processedAt).not.toBeNull()
    expect(seen).toHaveLength(1)
  })

  test('does not lose an event with no registered handler; it enters retry backoff', async () => {
    await seedEvent('order.created')

    await dispatchOutbox(db, logger, {})

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.nextRetryAt).not.toBeNull()
  })

  test('returns a failing event to pending with backoff, then dead-letters after max attempts', async () => {
    await seedEvent('flaky')
    const throwing = {
      flaky: () => {
        throw new Error('boom')
      },
    }

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      await dispatchOutbox(db, logger, throwing)
      const [row] = await db.select().from(schema.outboxEvents)
      expect(row.attempts).toBe(attempt)
      if (attempt < OUTBOX_MAX_ATTEMPTS) {
        expect(row.status).toBe('pending')
        // 退避未到期不可重新 claim; 拨回过去模拟重试窗口
        await db
          .update(schema.outboxEvents)
          .set({ nextRetryAt: new Date(Date.now() - 1000) })
          .where(eq(schema.outboxEvents.id, row.id))
      } else {
        expect(row.status).toBe('failed')
      }
    }
  })

  test('reclaims an event left processing by a crashed worker and dispatches it', async () => {
    await seedEvent()
    const seen: unknown[] = []
    const handlers: Record<string, OutboxEventHandler> = {
      'payment.succeeded': (event) => {
        seen.push(event)
      },
    }

    // 模拟崩溃: claim 后进程死亡, updated_at 停留在阈值之前
    const [crashed] = await claimOutboxBatch(db)
    await db
      .update(schema.outboxEvents)
      .set({ updatedAt: new Date(Date.now() - OUTBOX_STALE_THRESHOLD_MS - 1000) })
      .where(eq(schema.outboxEvents.id, crashed.id))

    await dispatchOutbox(db, logger, handlers)

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('completed')
    expect(row.processedAt).not.toBeNull()
    // 崩溃那次 claim 已计一次, 回收重投递增到 2
    expect(row.attempts).toBe(2)
    expect(seen).toHaveLength(1)
  })

  test('payment.succeeded bridge enqueues an email job via the notifications usecase', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ name: 'Alice', email: 'alice@example.com', passwordHash: 'not-a-real-hash' })
      .returning()
    const [order] = await db
      .insert(schema.orders)
      .values({ userId: user.id, status: 'paid', totalAmount: '25.00' })
      .returning()
    const paymentId = crypto.randomUUID()
    await insertOutboxEvent(db, {
      eventType: 'payment.succeeded',
      aggregateType: 'payment',
      aggregateId: paymentId,
      payload: {
        orderId: order.id,
        paymentId,
        amount: '25.00',
        currency: 'CNY',
        provider: 'mock',
        paidAt: new Date().toISOString(),
      },
    })

    const jobs: { name: string; data: SendEmailJobData; jobId?: string }[] = []
    // 与 outboxWorker.ts 中注册的桥接 handler 同构(生产者替换为测试桩)
    const handlers: Record<string, OutboxEventHandler> = {
      'payment.succeeded': (event) =>
        sendPaymentSucceededEmail(event, {
          client: db,
          emailQueue: {
            async add(name, data, opts) {
              jobs.push({ name, data, jobId: opts?.jobId })
            },
          },
        }),
    }

    await dispatchOutbox(db, logger, handlers)

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('completed')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('payment-succeeded')
    expect(jobs[0].jobId).toBe(`payment-succeeded-${paymentId}`)
    expect(jobs[0].data.to).toBe('alice@example.com')
    expect(jobs[0].data.payload).toMatchObject({ name: 'Alice', orderId: order.id })
  })
})
