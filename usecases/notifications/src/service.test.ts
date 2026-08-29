import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { EMAIL_JOB_NAMES, type SendEmailJobData } from '@epinfresh/user/jobs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import {
  type EmailQueuePort,
  sendOrderShippedEmail,
  sendPaymentSucceededEmail,
  sendRefundSucceededEmail,
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

  test('enqueues a refund-succeeded email with deterministic jobId from refundNo', async () => {
    const { user, order } = await seedPaidOrder()
    const emailQueue = createFakeQueue()

    await sendRefundSucceededEmail(
      {
        id: 'e2',
        payload: {
          refundNo: 'rf-1',
          paymentId: crypto.randomUUID(),
          orderId: order.id,
          amount: '25.00',
          currency: 'CNY',
          refundedAt: new Date().toISOString(),
        },
      },
      { client: db, emailQueue },
    )

    expect(emailQueue.jobs).toHaveLength(1)
    const job = emailQueue.jobs[0]
    expect(job.name).toBe(EMAIL_JOB_NAMES.REFUND_SUCCEEDED)
    expect(job.jobId).toBe('refund-succeeded-rf-1')
    expect(job.data.to).toBe(user.email)
    expect(job.data.payload).toMatchObject({ name: 'Alice', orderId: order.id, refundNo: 'rf-1' })
  })

  test('enqueues an order-shipped email; trackingNumber is optional', async () => {
    const { order } = await seedPaidOrder()
    const emailQueue = createFakeQueue()

    await sendOrderShippedEmail(
      {
        id: 'e3',
        payload: {
          orderId: order.id,
          trackingNumber: 'SF123',
          shippedAt: new Date().toISOString(),
        },
      },
      { client: db, emailQueue },
    )
    await sendOrderShippedEmail(
      { id: 'e4', payload: { orderId: order.id, shippedAt: new Date().toISOString() } },
      { client: db, emailQueue },
    )

    expect(emailQueue.jobs).toHaveLength(2)
    expect(emailQueue.jobs[0].name).toBe(EMAIL_JOB_NAMES.ORDER_SHIPPED)
    expect(emailQueue.jobs[0].jobId).toBe(`order-shipped-${order.id}`)
    expect(emailQueue.jobs[0].data.payload).toMatchObject({
      name: 'Alice',
      trackingNumber: 'SF123',
    })
    expect(emailQueue.jobs[1].data.payload).toMatchObject({
      name: 'Alice',
      trackingNumber: undefined,
    })
  })

  test('order-shipped throws when the order is missing (retry → dead-letter)', async () => {
    const emailQueue = createFakeQueue()

    expect(
      sendOrderShippedEmail(
        {
          id: 'e5',
          payload: { orderId: crypto.randomUUID(), shippedAt: new Date().toISOString() },
        },
        { client: db, emailQueue },
      ),
    ).rejects.toThrow(/order not found/)
    expect(emailQueue.jobs).toHaveLength(0)
  })
})
