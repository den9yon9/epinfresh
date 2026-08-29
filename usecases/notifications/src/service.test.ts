import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { EMAIL_JOB_NAMES, type SendEmailJobData } from '@epinfresh/user/jobs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { type EmailQueuePort, sendPaymentSucceededEmail } from './service'

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

interface CapturedJob {
  name: string
  data: SendEmailJobData
  jobId?: string
}

function createFakeQueue(): EmailQueuePort & { jobs: CapturedJob[] } {
  const jobs: CapturedJob[] = []
  return {
    jobs,
    async add(name, data, opts) {
      jobs.push({ name, data, jobId: opts?.jobId })
    },
  }
}

function seedEventPayload(orderId: string, paymentId: string) {
  return {
    id: crypto.randomUUID(),
    payload: {
      orderId,
      paymentId,
      amount: '25.00',
      currency: 'CNY',
      provider: 'mock',
      paidAt: new Date().toISOString(),
    },
  }
}

async function seedPaidOrder() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email: 'alice@example.com', passwordHash: 'not-a-real-hash' })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status: 'paid', totalAmount: '25.00' })
    .returning()
  return { user, order }
}

describe('sendPaymentSucceededEmail', () => {
  test('enqueues a payment-succeeded email addressed to the order user', async () => {
    const { user, order } = await seedPaidOrder()
    const event = seedEventPayload(order.id, crypto.randomUUID())
    const emailQueue = createFakeQueue()

    await sendPaymentSucceededEmail(event, { client: db, emailQueue })

    expect(emailQueue.jobs).toHaveLength(1)
    const job = emailQueue.jobs[0]
    expect(job.name).toBe(EMAIL_JOB_NAMES.PAYMENT_SUCCEEDED)
    expect(job.jobId).toBe(`payment-succeeded-${event.payload.paymentId}`)
    expect(job.data.to).toBe(user.email)
    expect(job.data.payload).toMatchObject({
      name: 'Alice',
      orderId: order.id,
      amount: '25.00',
      currency: 'CNY',
      provider: 'mock',
    })
  })

  test('throws (retry → dead-letter) when the event references a missing order', async () => {
    const event = seedEventPayload(crypto.randomUUID(), crypto.randomUUID())
    const emailQueue = createFakeQueue()

    expect(sendPaymentSucceededEmail(event, { client: db, emailQueue })).rejects.toThrow(
      /order not found/,
    )
    expect(emailQueue.jobs).toHaveLength(0)
  })

  test('throws when the event payload is malformed', async () => {
    const emailQueue = createFakeQueue()

    expect(
      sendPaymentSucceededEmail({ id: 'e1', payload: {} }, { client: db, emailQueue }),
    ).rejects.toThrow(/missing "orderId"/)
    expect(emailQueue.jobs).toHaveLength(0)
  })
})
