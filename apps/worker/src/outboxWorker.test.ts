import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { insertOutboxEvent, OUTBOX_MAX_ATTEMPTS } from '@epinfresh/outbox'
import { createLogger } from '@epinfresh/shared'
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

    await dispatchOutbox(db, logger)

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('completed')
    expect(row.processedAt).not.toBeNull()
  })

  test('does not lose an event with no registered handler; it enters retry backoff', async () => {
    await seedEvent('order.created')

    await dispatchOutbox(db, logger)

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
})
