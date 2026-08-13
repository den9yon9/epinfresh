import { treaty } from '@elysiajs/eden'
import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createMockPaymentGateway } from '@epinfresh/payment'
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
    paymentGateway: createMockPaymentGateway(),
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
  emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl: env.TESTING_REDIS_URL })
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
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    expect(payRes.status).toBe(201)
    if (payRes.error !== null) throw payRes.error
    expect(payRes.data.status).toBe('pending')
    const paymentId = payRes.data.id

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
      .pay.post({} as never, { fetch: { headers: { cookie: otherCookie } } })
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
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'ORDER_NOT_PENDING' })
  })

  test('confirming an already confirmed payment is rejected', async () => {
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
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    if (payRes.error !== null) throw payRes.error
    const paymentId = payRes.data.id

    const confirmRes = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    if (confirmRes.error !== null) throw confirmRes.error
    expect(confirmRes.data.status).toBe('succeeded')

    const again = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    expect(again.status).toBe(409)
    if (again.error === null) throw new Error('expected error response')
    expect(again.error.value).toMatchObject({ error: 'INVALID_PAYMENT_STATE' })
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
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    if (payRes.error !== null) throw payRes.error
    const paymentId = payRes.data.id
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
