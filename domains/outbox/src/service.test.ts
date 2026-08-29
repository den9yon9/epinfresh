import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  claimOutboxBatch,
  completeOutboxEvent,
  failOutboxEvent,
  insertOutboxEvent,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STALE_THRESHOLD_MS,
  resetStaleOutboxEvents,
} from './service'

let db: Db

beforeAll(async () => {
  db = await prepareTestDb()
})

afterAll(async () => {
  if (db) await closeDb(db)
})

beforeEach(async () => {
  await resetDb(db)
})

async function seedEvent(overrides: Partial<Parameters<typeof insertOutboxEvent>[1]> = {}) {
  await insertOutboxEvent(db, {
    eventType: 'payment.succeeded',
    aggregateType: 'payment',
    aggregateId: crypto.randomUUID(),
    payload: { orderId: 'order-1', amount: '25.00' },
    ...overrides,
  })
}

// 把 next_retry_at 拨回过去, 让事件重新可被 claim(模拟退避到期)
async function forceEligible(id: string) {
  await db
    .update(schema.outboxEvents)
    .set({ nextRetryAt: new Date(Date.now() - 1000) })
    .where(eq(schema.outboxEvents.id, id))
}

// 把 updated_at 拨回阈值之前(模拟 claim 后进程崩溃、时间流逝)
async function ageBeyondStaleThreshold(id: string) {
  await db
    .update(schema.outboxEvents)
    .set({ updatedAt: new Date(Date.now() - OUTBOX_STALE_THRESHOLD_MS - 1000) })
    .where(eq(schema.outboxEvents.id, id))
}

describe('insertOutboxEvent', () => {
  test('persists a pending event with round-tripped payload', async () => {
    await seedEvent({
      aggregateId: crypto.randomUUID(),
      payload: { amount: '25.00', userId: 'u1' },
    })

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.payload).toEqual({ amount: '25.00', userId: 'u1' })
  })
})

describe('claimOutboxBatch', () => {
  test('claims pending events as processing and increments attempts atomically', async () => {
    await seedEvent()

    const claimed = await claimOutboxBatch(db)
    expect(claimed).toHaveLength(1)
    expect(claimed[0].status).toBe('processing')
    expect(claimed[0].attempts).toBe(1)

    // 已抢占的事件不再被第二次 claim
    const again = await claimOutboxBatch(db)
    expect(again).toHaveLength(0)
  })

  test('respects the batch limit and keeps the remainder pending', async () => {
    await seedEvent()
    await seedEvent()
    await seedEvent()

    const claimed = await claimOutboxBatch(db, 2)
    expect(claimed).toHaveLength(2)

    const remaining = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.status, 'pending'))
    expect(remaining).toHaveLength(1)
  })

  test('refreshes updated_at on claim (staleness clock for stale reset)', async () => {
    await seedEvent()
    await db
      .update(schema.outboxEvents)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.outboxEvents.status, 'pending'))
    const [before] = await db.select().from(schema.outboxEvents)

    await claimOutboxBatch(db)

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
  })

  test('skips events whose retry backoff has not elapsed', async () => {
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db)
    await failOutboxEvent(db, claimed.id, claimed.attempts)

    // next_retry_at 在未来, 不可 claim
    const notEligible = await claimOutboxBatch(db)
    expect(notEligible).toHaveLength(0)

    // 退避到期后恢复可 claim
    await forceEligible(claimed.id)
    const eligible = await claimOutboxBatch(db)
    expect(eligible).toHaveLength(1)
    expect(eligible[0].attempts).toBe(2)
  })
})

describe('resetStaleOutboxEvents', () => {
  test('reclaims a stale processing event and it becomes claimable again', async () => {
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db)
    await ageBeyondStaleThreshold(claimed.id)

    const reset = await resetStaleOutboxEvents(db, new Date(Date.now() - OUTBOX_STALE_THRESHOLD_MS))
    expect(reset).toBe(1)

    const [row] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, claimed.id))
    expect(row.status).toBe('pending')
    expect(row.nextRetryAt).not.toBeNull()
    // 崩溃那次已计入 attempts, 回收不清零: 反复崩溃自然收敛到死信
    expect(row.attempts).toBe(1)

    // 回收后立即可以重新 claim, attempts 递增
    const reclaimed = await claimOutboxBatch(db)
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0].attempts).toBe(2)
  })

  test('leaves a freshly claimed processing event alone', async () => {
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db)

    const reset = await resetStaleOutboxEvents(db, new Date(Date.now() - OUTBOX_STALE_THRESHOLD_MS))
    expect(reset).toBe(0)

    const [row] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, claimed.id))
    expect(row.status).toBe('processing')
  })

  test('only touches processing rows, never pending/completed/failed', async () => {
    await seedEvent() // pending
    await seedEvent()
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db, 1) // 只领 1 个 → completed
    await completeOutboxEvent(db, claimed.id)
    const [pending] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.status, 'pending'))
      .limit(1)
    // 直接置死信终态(死信产生路径已由 failOutboxEvent 用例覆盖)
    await db
      .update(schema.outboxEvents)
      .set({ status: 'failed', nextRetryAt: null })
      .where(eq(schema.outboxEvents.id, pending.id))

    const reset = await resetStaleOutboxEvents(db, new Date(Date.now() - OUTBOX_STALE_THRESHOLD_MS))
    expect(reset).toBe(0)

    const rows = await db.select().from(schema.outboxEvents)
    expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'failed', 'pending'])
  })
})

describe('completeOutboxEvent', () => {
  test('marks a processing event completed with processed_at', async () => {
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db)

    await completeOutboxEvent(db, claimed.id)

    const [row] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, claimed.id))
    expect(row.status).toBe('completed')
    expect(row.processedAt).not.toBeNull()
  })
})

describe('failOutboxEvent', () => {
  test('returns failed events to pending with exponential backoff', async () => {
    await seedEvent()
    const [claimed] = await claimOutboxBatch(db)

    await failOutboxEvent(db, claimed.id, claimed.attempts)

    const [row] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, claimed.id))
    expect(row.status).toBe('pending')
    expect(row.nextRetryAt).not.toBeNull()
    expect(row.nextRetryAt!.getTime()).toBeGreaterThan(Date.now())
  })

  test('dead-letters an event after exceeding max attempts', async () => {
    await seedEvent()

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      const [claimed] = await claimOutboxBatch(db)
      expect(claimed).toBeDefined()
      await failOutboxEvent(db, claimed.id, claimed.attempts)
      if (attempt < OUTBOX_MAX_ATTEMPTS) await forceEligible(claimed.id)
    }

    const [row] = await db.select().from(schema.outboxEvents)
    expect(row.status).toBe('failed')
    expect(row.nextRetryAt).toBeNull()
  })
})
