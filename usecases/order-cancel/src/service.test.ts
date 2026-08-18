import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createOrderRecord, updateOrderStatus } from '@epinfresh/order'
import { createMockPaymentGateway, initiatePayment, type PaymentGateway } from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { reduceProductStock } from '@epinfresh/product'
import { err, ok } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { cancelOrder } from './service'

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

const mockGateways = { mock: createMockPaymentGateway() }

async function seedUser(email = 'alice@example.com') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email, passwordHash: 'not-a-real-hash' })
    .returning()
  return user
}

async function seedSku(name: string, slug: string, price = '5.00', stock = 10) {
  const [product] = await db
    .insert(schema.products)
    .values({ name, slug, status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({
      productId: product.id,
      name: '1kg',
      skuCode: `${slug.toUpperCase()}-1KG`,
      price,
      stock,
    })
    .returning()
  return { product, sku }
}

async function seedOrder(userId: string, skuId: string, quantity = 2) {
  const [address] = await db
    .insert(schema.addresses)
    .values({ userId, recipientName: 'Alice', phone: '13800000000', address: 'Shanghai Pudong' })
    .returning()
  const order = await createOrderRecord(
    userId,
    [{ skuId, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity }],
    {
      addressId: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      address: address.address,
    },
    db,
  )
  await reduceProductStock(skuId, quantity, db)
  return order
}

async function skuStock(skuId: string) {
  const [sku] = await db.select().from(schema.productSkus).where(eq(schema.productSkus.id, skuId))
  return Number(sku.stock)
}

describe('cancelOrder', () => {
  test('cancels a pending order and restores stock', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)

    const result = await cancelOrder(order.id, mockGateways, db)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(10)
  })

  test('cancels a paid order: refunds via gateway and restores stock', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    await confirmOrderPayment(payment.id, db)

    const result = await cancelOrder(order.id, mockGateways, db)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('cancelled')
    // 已支付未发货取消: 商品回库存
    expect(await skuStock(sku.id)).toBe(10)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
  })

  test('does not cancel when the gateway refund is rejected', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    await confirmOrderPayment(payment.id, db)
    const failingGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return err('GATEWAY_ERROR')
      },
    }

    const result = await cancelOrder(order.id, { mock: failingGateway }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('GATEWAY_ERROR')

    // 本地状态不变: 订单仍 paid, 支付单仍 succeeded, 库存不回
    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('paid')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(await skuStock(sku.id)).toBe(8)
  })

  test('async refund (wechat processing): cancels order, restocks, records processing refund', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    await confirmOrderPayment(payment.id, db)
    const asyncGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return ok({ refundId: 'wx-refund-1', status: 'processing' })
      },
    }

    const result = await cancelOrder(order.id, { mock: asyncGateway }, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(10)

    // 支付单保持 succeeded(等退款通知翻转), 退款单 processing
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('succeeded')
    const refunds = await db.select().from(schema.refunds)
    expect(refunds).toHaveLength(1)
    expect(refunds[0].status).toBe('processing')
    expect(refunds[0].outRefundNo).toBe(`rf-${payment.id}`)
  })

  test('rejects cancelling again once a refund record exists', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    await confirmOrderPayment(payment.id, db)
    const asyncGateway: PaymentGateway = {
      ...createMockPaymentGateway(),
      async refund() {
        return ok({ refundId: 'wx-refund-1', status: 'processing' })
      },
    }

    await cancelOrder(order.id, { mock: asyncGateway }, db)
    const again = await cancelOrder(order.id, { mock: asyncGateway }, db)
    expect(again.isErr()).toBe(true)
    expect(again._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
  })

  test('rejects cancelling a shipped order', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)
    await updateOrderStatus(order.id, 'paid', db)
    await updateOrderStatus(order.id, 'shipped', db)

    const result = await cancelOrder(order.id, mockGateways, db)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INVALID_TRANSITION')
    expect(await skuStock(sku.id)).toBe(8)
  })

  test('concurrent cancels restore stock only once', async () => {
    const user = await seedUser()
    const { sku } = await seedSku('Apple', 'apple', '5.00', 10)
    const order = await seedOrder(user.id, sku.id, 2)

    const results = await Promise.all([
      cancelOrder(order.id, mockGateways, db),
      cancelOrder(order.id, mockGateways, db),
    ])

    expect(results.filter((r) => r.isOk())).toHaveLength(1)
    expect(results.filter((r) => r.isErr())).toHaveLength(1)
    expect(await skuStock(sku.id)).toBe(10)
  })

  test('returns ORDER_NOT_FOUND for unknown order', async () => {
    const result = await cancelOrder('00000000-0000-4000-8000-000000000000', mockGateways, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ORDER_NOT_FOUND')
  })
})
