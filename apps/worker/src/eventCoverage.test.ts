// 行为级守护: "业务转变 → 必须产生的 outbox 事件" 契约。
// lint 只能管静态边界, 事件是否真的与业务同事务落库只能跑真实服务函数验证——
// 新增支付/退款/发货路径若遗漏事件写入, 本测试必红(同时提醒在 outboxWorker 补 handler)。
import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { cancelOrder } from '@epinfresh/order-cancel'
import { createMockPaymentGateway, initiatePayment } from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { refundOrderWorkflow } from '@epinfresh/payment-refund'
import { shipOrder } from '@epinfresh/ship-order'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

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

async function seedPendingOrder(email = 'alice@example.com', slugSuffix = 'cov') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email, passwordHash: 'not-a-real-hash' })
    .returning()
  const [product] = await db
    .insert(schema.products)
    .values({ name: 'Apple', slug: `apple-${slugSuffix}`, status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({
      productId: product.id,
      name: '1kg',
      skuCode: `${slugSuffix.toUpperCase()}-1KG`,
      price: '5.00',
      stock: 10,
    })
    .returning()
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, status: 'pending', totalAmount: '10.00' })
    .returning()
  await db.insert(schema.orderItems).values({
    orderId: order.id,
    skuId: sku.id,
    productName: product.name,
    skuName: sku.name,
    unitPrice: sku.price,
    quantity: 2,
    subtotal: '10.00',
  })
  return order
}

// pending → paid: 走真实支付确认编排
async function payAndConfirm(orderId: string) {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId))
  const initiated = await initiatePayment(
    { id: order.id, totalAmount: order.totalAmount, currency: order.currency },
    createMockPaymentGateway(),
    db,
  )
  const payment = initiated._unsafeUnwrap().payment
  const confirmed = await confirmOrderPayment(payment.id, db)
  if (confirmed.isErr()) throw new Error('seed confirm failed')
  return payment
}

async function eventsOfType(orderId: string, eventType: string) {
  const rows = await db
    .select()
    .from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.eventType, eventType))
  return rows.filter((row) => (row.payload as { orderId?: string }).orderId === orderId)
}

const mockGateways = { mock: createMockPaymentGateway() }

describe('outbox event coverage: state transitions must emit their events', () => {
  test('confirmOrderPayment emits payment.succeeded', async () => {
    const order = await seedPendingOrder()

    await payAndConfirm(order.id)

    const events = await eventsOfType(order.id, 'payment.succeeded')
    expect(events).toHaveLength(1)
    expect(events[0].aggregateType).toBe('payment')
    expect(events[0].status).toBe('pending')
  })

  test('cancelling a paid order (sync refund) emits refund.succeeded', async () => {
    const order = await seedPendingOrder('bob@example.com', 'cov-cancel')
    await payAndConfirm(order.id)

    const result = await cancelOrder(order.id, mockGateways, db)

    expect(result.isOk()).toBe(true)
    const events = await eventsOfType(order.id, 'refund.succeeded')
    expect(events).toHaveLength(1)
    expect(events[0].aggregateType).toBe('refund')
  })

  test('cancelling a pending order emits no payment/refund events', async () => {
    const order = await seedPendingOrder('carol@example.com', 'cov-pending')

    const result = await cancelOrder(order.id, mockGateways, db)

    expect(result.isOk()).toBe(true)
    expect(await eventsOfType(order.id, 'refund.succeeded')).toHaveLength(0)
    expect(await eventsOfType(order.id, 'payment.succeeded')).toHaveLength(0)
  })

  test('refundOrderWorkflow (sync refund) emits refund.succeeded', async () => {
    const order = await seedPendingOrder('dave@example.com', 'cov-refund')
    await payAndConfirm(order.id)

    const result = await refundOrderWorkflow(order.id, mockGateways, db)

    expect(result.isOk()).toBe(true)
    const events = await eventsOfType(order.id, 'refund.succeeded')
    expect(events).toHaveLength(1)
  })

  test('ship emits order.shipped exactly once across first shipment and corrections', async () => {
    const order = await seedPendingOrder('eve@example.com', 'cov-ship')
    await payAndConfirm(order.id)

    const first = await shipOrder(order.id, 'SF123', 'sf', db)
    expect(first.isOk()).toBe(true)
    // 运单号补录(re-ship)不重发事件
    const correction = await shipOrder(order.id, 'SF456', undefined, db)
    expect(correction.isOk()).toBe(true)

    const events = await eventsOfType(order.id, 'order.shipped')
    expect(events).toHaveLength(1)
  })

  test('full lifecycle accumulates exactly one payment.succeeded + one order.shipped', async () => {
    const order = await seedPendingOrder('frank@example.com', 'cov-life')
    await payAndConfirm(order.id)
    const shipped = await shipOrder(order.id, 'SF123', 'sf', db)
    expect(shipped.isOk()).toBe(true)

    const all = await db.select().from(schema.outboxEvents)
    const forOrder = all.filter((row) => (row.payload as { orderId?: string }).orderId === order.id)
    expect(forOrder.map((row) => row.eventType).sort()).toEqual([
      'order.shipped',
      'payment.succeeded',
    ])
  })
})
