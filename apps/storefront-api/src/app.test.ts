import { treaty } from '@elysiajs/eden'
import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import {
  buildSimulatedCallback,
  type PayMockServer,
  startPayMockServer,
} from '@epinfresh/pay-mock-server'
import {
  createMockPaymentGateway,
  createPaymentGateways,
  generateRsaKeyPair,
  initiatePayment,
} from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { createQueue, type Queue } from '@epinfresh/queue'
import { createRedisClient, type Redis } from '@epinfresh/redis'
import { flushTestRedis } from '@epinfresh/redis/testing'
import { createLogger, hashPassword } from '@epinfresh/shared'
import { getTestEnv } from '@epinfresh/shared/testing'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { type StorefrontAppOptions } from './deps'
import { type App, buildApp } from './index'

const env = getTestEnv()

let app: App
let db: Db
let redis: Redis
let emailQueue: Queue<SendEmailJobData>
let api: ReturnType<typeof treaty<typeof app>>

function createTestDeps(deps: {
  db: Db
  redis: Redis
  emailQueue: Queue<SendEmailJobData>
}): StorefrontAppOptions {
  return {
    ...deps,
    paymentGateways: createPaymentGateways([{ channel: 'mock' }]),
    wechatOauth: {
      enabled: false,
      baseUrl: '',
      apiBase: '',
      appId: '',
      appSecret: '',
    },
    sessionSecret: env.TESTING_SESSION_SECRET,
    corsOrigin: true,
    trustProxy: false,
    isProduction: false,
    logger: createLogger('silent'),
  }
}

beforeAll(async () => {
  db = await prepareTestDb()
  redis = createRedisClient(env.TESTING_REDIS_URL)
  emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { connection: redis })
  app = buildApp(createTestDeps({ db, redis, emailQueue }))
  api = treaty<typeof app>(app)
})

afterAll(async () => {
  await Promise.allSettled([closeDb(db), redis.quit(), emailQueue.close()])
})

beforeEach(async () => {
  await resetDb(db)
  await flushTestRedis()
})

async function seedUser(email: string, role: 'customer' | 'admin' = 'customer') {
  const passwordHash = await hashPassword('password123')
  const [user] = await db
    .insert(schema.users)
    .values({ name: email.split('@')[0], email, passwordHash, role })
    .returning()
  return user
}

async function seedSku(
  slug: string,
  price = '5.00',
  stock = 10,
  status: ProductStatus = 'published',
) {
  const [product] = await db
    .insert(schema.products)
    .values({ name: slug, slug, status })
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

async function seedAddress(userId: string) {
  const [address] = await db
    .insert(schema.addresses)
    .values({
      userId,
      recipientName: 'Alice',
      phone: '13800000000',
      address: 'Shanghai Pudong',
      isDefault: true,
    })
    .returning()
  return address
}

async function skuStock(skuId: string) {
  const [sku] = await db.select().from(schema.productSkus).where(eq(schema.productSkus.id, skuId))
  return Number(sku.stock)
}

function sessionCookie(res: { headers: unknown }): string {
  return (new Headers(res.headers as Headers).get('set-cookie') ?? '').split(';')[0]
}

async function loginCookie(email: string): Promise<string> {
  const login = await api.auth.login.post({ email, password: 'password123' })
  return sessionCookie(login)
}

describe('health', () => {
  test('returns ok with db and redis reachable', async () => {
    const res = await api.health.get()
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ status: 'ok', db: true, redis: true })
  })
})

describe('auth', () => {
  test('register creates a user and never returns passwordHash', async () => {
    const res = await api.auth.register.post({
      name: 'Alice',
      email: 'a@example.com',
      password: 'password123',
    })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.email).toBe('a@example.com')
    expect('passwordHash' in res.data).toBe(false)
  })

  test('login sets a signed session cookie and tampering is rejected', async () => {
    await seedUser('alice@example.com')
    const login = await api.auth.login.post({ email: 'alice@example.com', password: 'password123' })
    expect(login.status).toBe(200)
    const cookie = sessionCookie(login)
    expect(cookie).toMatch(/^session_id=[^;]+\./)
    expect(cookie).not.toBe('')

    const me = await api.auth.me.get({ fetch: { headers: { cookie } } })
    expect(me.status).toBe(200)
    if (me.error !== null) throw me.error
    expect(me.data.email).toBe('alice@example.com')
    expect('passwordHash' in me.data).toBe(false)

    const tampered = cookie.replace(/\.\S+$/, '.forged')
    const rejected = await api.auth.me.get({ fetch: { headers: { cookie: tampered } } })
    expect(rejected.status).toBe(400)
  })

  test('forgot-password returns 202 for known and unknown emails', async () => {
    await seedUser('reset@example.com')
    const known = await api.auth['forgot-password'].post({ email: 'reset@example.com' })
    expect(known.status).toBe(202)
    const unknown = await api.auth['forgot-password'].post({ email: 'ghost@example.com' })
    expect(unknown.status).toBe(202)
  })

  test('reset-password full cycle via token from queued job', async () => {
    await seedUser('reset@example.com')
    await api.auth['forgot-password'].post({ email: 'reset@example.com' })

    const jobs = await emailQueue.getJobs(['waiting'])
    const resetJob = jobs.find((j) => j.name === 'reset-password')
    expect(resetJob).toBeDefined()
    const token = resetJob!.data.payload.token as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)

    const res = await api.auth['reset-password'].post({ token, password: 'new-password-2' })
    expect(res.status).toBe(204)

    const oldLogin = await api.auth.login.post({
      email: 'reset@example.com',
      password: 'password123',
    })
    expect(oldLogin.status).toBe(401)
    const newLogin = await api.auth.login.post({
      email: 'reset@example.com',
      password: 'new-password-2',
    })
    expect(newLogin.status).toBe(200)

    const replay = await api.auth['reset-password'].post({
      token,
      password: 'another-pass-3',
    })
    expect(replay.status).toBe(400)
    if (replay.error === null) throw new Error('expected error response')
    expect(replay.error.value).toMatchObject({ error: 'RESET_TOKEN_INVALID' })
  })

  test('reset-password rejects unknown token with 400', async () => {
    const res = await api.auth['reset-password'].post({
      token: 'f'.repeat(64),
      password: 'new-password-2',
    })
    expect(res.status).toBe(400)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'RESET_TOKEN_INVALID' })
  })

  test('login rejects wrong password with 401', async () => {
    await seedUser('alice@example.com')
    const res = await api.auth.login.post({ email: 'alice@example.com', password: 'wrong-pass' })
    expect(res.status).toBe(401)
  })

  test('me returns 401 without a session', async () => {
    const res = await api.auth.me.get()
    expect(res.status).toBe(401)
  })

  test('logout clears the session', async () => {
    await seedUser('alice@example.com')
    const cookie = await loginCookie('alice@example.com')

    const logout = await api.auth.logout.post({} as never, { fetch: { headers: { cookie } } })
    expect(logout.status).toBe(204)

    const me = await api.auth.me.get({ fetch: { headers: { cookie } } })
    expect(me.status).toBe(401)
  })

  test('patch /me updates profile without touching role', async () => {
    await seedUser('alice@example.com')
    const cookie = await loginCookie('alice@example.com')

    const res = await api.auth.me.patch(
      { name: 'Alice Updated', phone: '13900000000', avatar: 'https://img.example.com/a.png' },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.name).toBe('Alice Updated')
    expect(res.data.phone).toBe('13900000000')
    expect(res.data.avatar).toBe('https://img.example.com/a.png')
    expect(res.data.role).toBe('customer')
    expect('passwordHash' in res.data).toBe(false)

    const me = await api.auth.me.get({ fetch: { headers: { cookie } } })
    if (me.error !== null) throw me.error
    expect(me.data.name).toBe('Alice Updated')
  })

  test('patch /me requires authentication', async () => {
    const res = await api.auth.me.patch({ name: 'Ghost' })
    expect(res.status).toBe(401)
  })
})

describe('addresses', () => {
  test('creates, lists, updates and deletes own addresses', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)

    const created = await api.addresses.post(
      { recipientName: 'Alice', phone: '13800000000', address: 'Shanghai Pudong' },
      { fetch: { headers: { cookie } } },
    )
    expect(created.status).toBe(201)
    if (created.error !== null) throw created.error
    expect(created.data.isDefault).toBe(true)

    const second = await api.addresses.post(
      { recipientName: 'Bob', phone: '13900000000', address: 'Beijing Haidian', isDefault: true },
      { fetch: { headers: { cookie } } },
    )
    expect(second.status).toBe(201)
    if (second.error !== null) throw second.error

    const list = await api.addresses.get({ fetch: { headers: { cookie } } })
    expect(list.status).toBe(200)
    if (list.error !== null) throw list.error
    expect(list.data.items).toHaveLength(2)
    expect(list.data.items.filter((a) => a.isDefault)).toHaveLength(1)
    expect(list.data.items[0].id).toBe(second.data.id)

    const updated = await api
      .addresses({ id: created.data.id })
      .put({ address: 'Shanghai Minhang' }, { fetch: { headers: { cookie } } })
    expect(updated.status).toBe(200)
    if (updated.error !== null) throw updated.error
    expect(updated.data.address).toBe('Shanghai Minhang')

    const deleted = await api
      .addresses({ id: created.data.id })
      .delete(undefined, { fetch: { headers: { cookie } } })
    expect(deleted.status).toBe(204)
  })

  test('cannot see or touch another user address', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const other = await seedUser('bob@example.com')
    const otherCookie = await loginCookie(other.email)
    const created = await api.addresses.post(
      { recipientName: 'Bob', phone: '1', address: 'Home' },
      { fetch: { headers: { cookie: otherCookie } } },
    )
    if (created.error !== null) throw created.error

    const list = await api.addresses.get({ fetch: { headers: { cookie } } })
    if (list.error !== null) throw list.error
    expect(list.data.items).toHaveLength(0)

    const get = await api.addresses({ id: created.data.id }).get({ fetch: { headers: { cookie } } })
    expect(get.status).toBe(404)

    const del = await api
      .addresses({ id: created.data.id })
      .delete(undefined, { fetch: { headers: { cookie } } })
    expect(del.status).toBe(404)
  })

  test('order carries an address snapshot even after the address is deleted', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const { sku } = await seedSku('apple', '5.00', 10)
    const created = await api.addresses.post(
      { recipientName: 'Alice', phone: '13800000000', address: 'Shanghai Pudong' },
      { fetch: { headers: { cookie } } },
    )
    if (created.error !== null) throw created.error

    const orderRes = await api.orders.post(
      { addressId: created.data.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(orderRes.status).toBe(201)
    if (orderRes.error !== null) throw orderRes.error
    expect(orderRes.data.recipientName).toBe('Alice')
    expect(orderRes.data.shippingAddress).toBe('Shanghai Pudong')

    const del = await api
      .addresses({ id: created.data.id })
      .delete(undefined, { fetch: { headers: { cookie } } })
    expect(del.status).toBe(204)

    const [after] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderRes.data.id))
    expect(after.addressId).toBeNull()
    expect(after.shippingAddress).toBe('Shanghai Pudong')
  })

  test('checkout with another user address returns 404', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const other = await seedUser('bob@example.com')
    const otherCookie = await loginCookie(other.email)
    const { sku } = await seedSku('apple', '5.00', 10)
    const created = await api.addresses.post(
      { recipientName: 'Bob', phone: '1', address: 'Home' },
      { fetch: { headers: { cookie: otherCookie } } },
    )
    if (created.error !== null) throw created.error

    const res = await api.orders.post(
      { addressId: created.data.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(404)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'ADDRESS_NOT_FOUND' })
  })
})

describe('cart', () => {
  test('adds, merges, updates, lists and clears items', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const { sku } = await seedSku('apple', '5.00', 10)

    const first = await api.cart.items.post(
      { skuId: sku.id, quantity: 2 },
      { fetch: { headers: { cookie } } },
    )
    expect(first.status).toBe(201)
    if (first.error !== null) throw first.error
    expect(first.data.quantity).toBe(2)
    expect(first.data.sku.price).toBe('5.00')
    expect(first.data.product.slug).toBe('apple')

    const merged = await api.cart.items.post(
      { skuId: sku.id, quantity: 3 },
      { fetch: { headers: { cookie } } },
    )
    expect(merged.status).toBe(201)
    if (merged.error !== null) throw merged.error
    expect(merged.data.quantity).toBe(5)

    const list = await api.cart.get({ fetch: { headers: { cookie } } })
    expect(list.status).toBe(200)
    if (list.error !== null) throw list.error
    expect(list.data.items).toHaveLength(1)

    const updated = await api.cart
      .items({ skuId: sku.id })
      .put({ quantity: 7 }, { fetch: { headers: { cookie } } })
    expect(updated.status).toBe(200)
    if (updated.error !== null) throw updated.error
    expect(updated.data.quantity).toBe(7)

    const removed = await api.cart
      .items({ skuId: sku.id })
      .delete(undefined, { fetch: { headers: { cookie } } })
    expect(removed.status).toBe(204)

    const second = await api.cart.items.post(
      { skuId: sku.id, quantity: 1 },
      { fetch: { headers: { cookie } } },
    )
    expect(second.status).toBe(201)

    const cleared = await api.cart.delete(undefined, { fetch: { headers: { cookie } } })
    expect(cleared.status).toBe(204)

    const after = await api.cart.get({ fetch: { headers: { cookie } } })
    if (after.error !== null) throw after.error
    expect(after.data.items).toHaveLength(0)
  })

  test('rejects adding an unavailable sku', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const { sku } = await seedSku('apple-draft', '5.00', 10, 'draft')

    const res = await api.cart.items.post(
      { skuId: sku.id, quantity: 1 },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'PRODUCT_UNAVAILABLE' })
  })

  test('carts are isolated per user', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)
    const other = await seedUser('bob@example.com')
    const otherCookie = await loginCookie(other.email)
    const { sku } = await seedSku('apple', '5.00', 10)

    await api.cart.items.post(
      { skuId: sku.id, quantity: 1 },
      { fetch: { headers: { cookie: otherCookie } } },
    )

    const list = await api.cart.get({ fetch: { headers: { cookie } } })
    if (list.error !== null) throw list.error
    expect(list.data.items).toHaveLength(0)

    const del = await api.cart
      .items({ skuId: sku.id })
      .delete(undefined, { fetch: { headers: { cookie } } })
    expect(del.status).toBe(404)
  })

  test('requires authentication', async () => {
    const res = await api.cart.get()
    expect(res.status).toBe(401)
  })
})

describe('orders', () => {
  test('creates an order and reduces stock', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 3 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(201)
    if (res.error !== null) throw res.error
    expect(res.data.totalAmount).toBe('15.00')
    expect(res.data.items).toHaveLength(1)

    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(7)
  })

  test('returns 404 SKU_NOT_FOUND for unknown sku', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      {
        addressId: address.id,
        items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(404)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'SKU_NOT_FOUND' })
  })

  test('returns 409 INSUFFICIENT_STOCK when quantity exceeds stock', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 2)
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 5 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({
      error: 'INSUFFICIENT_STOCK',
      skuId: sku.id,
      available: 2,
    })
  })

  test('returns 409 PRODUCT_UNAVAILABLE for a draft product sku', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple-draft', '5.00', 10, 'draft')
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'PRODUCT_UNAVAILABLE' })
  })

  test('requires authentication', async () => {
    const res = await api.orders.post({
      addressId: '00000000-0000-4000-8000-000000000000',
      items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    })
    expect(res.status).toBe(401)
  })

  test('cancels a pending order and restores stock', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const order = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 3 }] },
      { fetch: { headers: { cookie } } },
    )
    if (order.error !== null) throw order.error

    const res = await api
      .orders({ id: order.data.id })
      .cancel.post({}, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('cancelled')

    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(10)
  })

  test("rejects cancelling another user's order", async () => {
    const alice = await seedUser('alice@example.com')
    const bob = await seedUser('bob@example.com')
    const address = await seedAddress(alice.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const aliceCookie = await loginCookie(alice.email)
    const bobCookie = await loginCookie(bob.email)

    const order = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie: aliceCookie } } },
    )
    if (order.error !== null) throw order.error

    const res = await api
      .orders({ id: order.data.id })
      .cancel.post({}, { fetch: { headers: { cookie: bobCookie } } })
    expect(res.status).toBe(404)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'ORDER_NOT_FOUND' })
  })

  test('rejects cancelling a shipped order with 409', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const order = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (order.error !== null) throw order.error
    await db
      .update(schema.orders)
      .set({ status: 'shipped' })
      .where(eq(schema.orders.id, order.data.id))

    const res = await api
      .orders({ id: order.data.id })
      .cancel.post({}, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'INVALID_TRANSITION' })
  })

  test('cancelling a paid order refunds via gateway and restores stock', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const order = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 2 }] },
      { fetch: { headers: { cookie } } },
    )
    if (order.error !== null) throw order.error
    const payment = (
      await initiatePayment(order.data.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap().payment
    const confirmed = await confirmOrderPayment(payment.id, db)
    if (confirmed.isErr()) throw new Error('seed confirm failed')
    expect(await skuStock(sku.id)).toBe(8)

    const res = await api
      .orders({ id: order.data.id })
      .cancel.post({}, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(10)

    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
    expect(afterPayment.status).toBe('refunded')
  })

  test('same Idempotency-Key returns the same order twice', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)
    const body = { addressId: address.id, items: [{ skuId: sku.id, quantity: 2 }] }
    const options = { fetch: { headers: { cookie, 'idempotency-key': 'idem-1' } } }

    const first = await api.orders.post(body, options)
    expect(first.status).toBe(201)
    if (first.error !== null) throw first.error

    const second = await api.orders.post(body, options)
    expect(second.status).toBe(200)
    if (second.error !== null) throw second.error
    expect(second.data.id).toBe(first.data.id)

    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(8)
  })
})

describe('payments', () => {
  test('pay then confirm transitions the order to paid', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 2 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const payRes = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'mock' }, { fetch: { headers: { cookie } } })
    expect(payRes.status).toBe(201)
    if (payRes.error !== null) throw payRes.error
    expect(payRes.data.payment.status).toBe('pending')
    const paymentId = payRes.data.payment.id

    const confirmRes = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    expect(confirmRes.status).toBe(200)
    if (confirmRes.error !== null) throw confirmRes.error
    expect(confirmRes.data.status).toBe('succeeded')

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    expect(afterOrder.status).toBe('paid')
  })

  test('cannot pay someone else order', async () => {
    await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const alice = await seedUser('bob@example.com')
    const address = await seedAddress(alice.id)
    const cookie = await loginCookie(alice.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const other = await seedUser('carol@example.com')
    const otherCookie = await loginCookie(other.email)
    const res = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'mock' }, { fetch: { headers: { cookie: otherCookie } } })
    expect(res.status).toBe(404)
  })

  test('paying a non-pending order is rejected', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id
    await db.update(schema.orders).set({ status: 'cancelled' }).where(eq(schema.orders.id, orderId))

    const res = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'mock' }, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'ORDER_NOT_PENDING' })
  })

  test('confirming an already confirmed payment is idempotent', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const payRes = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'mock' }, { fetch: { headers: { cookie } } })
    if (payRes.error !== null) throw payRes.error
    const paymentId = payRes.data.payment.id

    const confirmRes = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    if (confirmRes.error !== null) throw confirmRes.error
    expect(confirmRes.data.status).toBe('succeeded')

    const again = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    expect(again.status).toBe(200)
    if (again.error !== null) throw again.error
    expect(again.data.status).toBe('succeeded')
  })

  test('lists payment records of own order', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const payRes = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'mock' }, { fetch: { headers: { cookie } } })
    if (payRes.error !== null) throw payRes.error
    const paymentId = payRes.data.payment.id
    await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })

    const res = await api.orders({ id: orderId }).payments.get({ fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].id).toBe(paymentId)
    expect(res.data.items[0].status).toBe('succeeded')
    expect(res.data.items[0].amount).toBe('5.00')
  })

  test('payments of another user order returns 404', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const other = await seedUser('bob@example.com')
    const otherCookie = await loginCookie(other.email)
    const res = await api
      .orders({ id: orderId })
      .payments.get({ fetch: { headers: { cookie: otherCookie } } })
    expect(res.status).toBe(404)
  })

  test('payments requires authentication', async () => {
    const res = await api.orders({ id: '00000000-0000-4000-8000-000000000000' }).payments.get()
    expect(res.status).toBe(401)
  })

  test('paying with an unconfigured channel is rejected', async () => {
    const user = await seedUser('alice@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const res = await api
      .orders({ id: orderId })
      .pay.post({ channel: 'wechat' }, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(400)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'PAYMENT_CHANNEL_NOT_CONFIGURED' })
  })

  test('notify rejects an unsupported channel with FAIL', async () => {
    const res = await api.payments.notify({ channel: 'mock' }).post('{}', {
      headers: { 'content-type': 'text/plain' },
    })
    expect(res.status).toBe(400)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toBe('FAIL')
  })

  test('notify returns FAIL for an unknown channel', async () => {
    const res = await api.payments.notify({ channel: 'wechat' }).post('{}', {
      headers: { 'content-type': 'text/plain' },
    })
    expect(res.status).toBe(400)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toBe('FAIL')
  })
})

describe('wechat payment through the real notify route', () => {
  const merchant = generateRsaKeyPair()
  const platform = generateRsaKeyPair()
  const API_V3_KEY = '0123456789abcdef0123456789abcdef'
  let mock: PayMockServer
  let wechatApp: App
  let wechatApi: ReturnType<typeof treaty<typeof wechatApp>>
  let notifyUrl: string

  beforeAll(async () => {
    // 模拟器只提供 /v3 下单端点; 回调用 buildSimulatedCallback 直发真实 notify 路由
    mock = startPayMockServer({
      port: 0,
      merchantId: 'mock-merchant-1',
      appId: 'mock-app-1',
      apiV3Key: API_V3_KEY,
      merchantPrivateKey: merchant.privateKey,
      platformPrivateKey: platform.privateKey,
      platformSerialNo: 'P-SERIAL-MOCK',
      notifyUrl: 'http://localhost:1/unused',
    })
    wechatApp = buildApp({
      ...createTestDeps({ db, redis, emailQueue }),
      paymentGateways: createPaymentGateways([
        { channel: 'mock' },
        {
          channel: 'wechat',
          config: {
            baseUrl: mock.url,
            merchantId: 'mock-merchant-1',
            appId: 'mock-app-1',
            apiV3Key: API_V3_KEY,
            merchantSerialNo: 'M-SERIAL-1',
            merchantPrivateKey: merchant.privateKey,
            platformPublicKey: platform.publicKey,
            notifyUrl: 'http://localhost:1/unused',
          },
        },
      ]),
    })
    await wechatApp.listen(0)
    const port = wechatApp.server?.port
    if (!port) throw new Error('wechat app did not bind a port')
    notifyUrl = `http://localhost:${port}/payments/notify/wechat`
    wechatApi = treaty<typeof wechatApp>(wechatApp)
  })

  afterAll(async () => {
    mock.stop()
    // 只停 HTTP server, 不触发 Elysia onStop(db/redis 由顶层 afterAll 统一关闭)
    wechatApp.server?.stop(true)
  })

  test('initiates wechat payment and confirms via simulated callback', async () => {
    const user = await seedUser('wechat@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('apple', '25.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await wechatApi.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    const payRes = await wechatApi
      .orders({ id: orderId })
      .pay.post({ channel: 'wechat' }, { fetch: { headers: { cookie } } })
    expect(payRes.status).toBe(201)
    if (payRes.error !== null) throw payRes.error
    expect(payRes.data.payload).toMatchObject({
      type: 'qr',
      codeUrl: expect.stringContaining('weixin://wxpay/bizpayurl'),
    })

    // 模拟器构造回调 → 直发真实 notify 路由(含 application/json 内容类型)
    const callback = buildSimulatedCallback(
      {
        merchantId: 'mock-merchant-1',
        appId: 'mock-app-1',
        apiV3Key: API_V3_KEY,
        merchantPrivateKey: merchant.privateKey,
        platformPrivateKey: platform.privateKey,
        platformSerialNo: 'P-SERIAL-MOCK',
        notifyUrl,
      },
      { outTradeNo: payRes.data.payment.outTradeNo, amount: payRes.data.payment.amount },
    )
    const notifyRes = await fetch(notifyUrl, {
      method: 'POST',
      headers: callback.headers,
      body: callback.body,
    })
    expect(notifyRes.status).toBe(200)
    expect(await notifyRes.text()).toBe('SUCCESS')

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    expect(afterOrder.status).toBe('paid')
    const [afterPayment] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payRes.data.payment.id))
    expect(afterPayment.status).toBe('succeeded')
    expect(afterPayment.providerTransactionId).toMatch(/^mock-txn-/)
  })

  test('H5 order through the real route returns a redirect payload', async () => {
    const user = await seedUser('wechat-h5@example.com')
    const address = await seedAddress(user.id)
    const { sku } = await seedSku('pear', '25.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await wechatApi.orders.post(
      { addressId: address.id, items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    if (orderRes.error !== null) throw orderRes.error
    const orderId = orderRes.data.id

    // 带 X-Forwarded-For + product=h5: 路由注入 clientIp 并走 H5 下单
    const payRes = await wechatApi
      .orders({ id: orderId })
      .pay.post(
        { channel: 'wechat', channelContext: { product: 'h5' } },
        { fetch: { headers: { cookie, 'x-forwarded-for': '203.0.113.9' } } },
      )
    expect(payRes.status).toBe(201)
    if (payRes.error !== null) throw payRes.error
    expect(payRes.data.payload).toMatchObject({
      type: 'redirect',
      url: expect.stringContaining('/__h5__/pay'),
    })
  })
})

describe('products', () => {
  test('lists published products only', async () => {
    await seedSku('apple', '5.00', 10, 'published')
    await seedSku('hidden', '5.00', 10, 'draft')

    const res = await api.products.get({ query: { page: 1, pageSize: 10 } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.total).toBe(1)
    expect(res.data.items[0].slug).toBe('apple')
  })
})

describe('wechat oauth + jssdk', () => {
  let oauthMock: PayMockServer
  let oauthApp: App
  let oauthApi: ReturnType<typeof treaty<typeof oauthApp>>

  beforeAll(async () => {
    const keys = generateRsaKeyPair()
    oauthMock = startPayMockServer({
      port: 0,
      merchantId: 'mock-merchant-1',
      appId: 'mock-app-1',
      apiV3Key: '0123456789abcdef0123456789abcdef',
      merchantPrivateKey: keys.privateKey,
      platformPrivateKey: keys.privateKey,
      platformSerialNo: 'P-SERIAL-MOCK',
      notifyUrl: 'http://localhost:1/unused',
    })
    oauthApp = buildApp({
      ...createTestDeps({ db, redis, emailQueue }),
      wechatOauth: {
        enabled: true,
        baseUrl: oauthMock.url,
        apiBase: oauthMock.url,
        appId: 'mock-app-1',
        appSecret: 'mock-secret',
      },
    })
    await oauthApp.listen(0)
    oauthApi = treaty<typeof oauthApp>(oauthApp)
  })

  afterAll(async () => {
    oauthMock.stop()
    oauthApp.server?.stop(true)
  })

  test('authorize → callback 302 with openid cookie → jssdk signature', async () => {
    // 用 127.0.0.1 直连, 保证回调 URL 命中同一监听地址
    const port = oauthApp.server?.port
    if (!port) throw new Error('oauth app did not bind')

    // 1. 授权入口 302 到 oauth base(redirect_uri 指向本应用回调)
    const auth = await fetch(
      `http://127.0.0.1:${port}/auth/wechat/authorize?redirectTo=${encodeURIComponent('/pay?orderId=abc')}`,
      { redirect: 'manual' },
    )
    expect(auth.status).toBe(302)
    const authLoc = auth.headers.get('location') ?? ''
    expect(authLoc).toContain('/connect/oauth2/authorize')
    expect(authLoc).toContain('redirect_uri=')

    // 2. 模拟微信授权页: 302 回跳本应用回调(code 换 openid), 再取回调响应的 set-cookie
    const oauthRedirect = await fetch(authLoc, { redirect: 'manual' })
    expect(oauthRedirect.status).toBe(302)
    const callbackLoc = oauthRedirect.headers.get('location') ?? ''
    expect(callbackLoc).toContain('/auth/wechat/callback')

    const callback = await fetch(callbackLoc, { redirect: 'manual' })
    expect(callback.status).toBe(302)
    const cookieHeader = callback.headers.get('set-cookie') ?? ''
    expect(cookieHeader).toContain('wechat_openid=')

    // 3. JS-SDK 签名
    const js = await oauthApi.wechat.jssdk.get({
      query: { url: 'http://localhost/pay?orderId=abc' },
    })
    expect(js.status).toBe(200)
    if (js.error !== null) throw js.error
    expect(js.data.appId).toBe('mock-app-1')
    expect(js.data.signature).toMatch(/^[0-9a-f]{40}$/)
  })

  test('jssdk returns 400 when oauth is disabled', async () => {
    const res = await api.wechat.jssdk.get({ query: { url: 'http://localhost/pay' } })
    expect(res.status).toBe(400)
  })
})
