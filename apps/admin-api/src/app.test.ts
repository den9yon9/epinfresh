import { treaty } from '@elysiajs/eden'
import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createOrderRecord, updateOrderStatus } from '@epinfresh/order'
import { createMockPaymentGateway, initiatePayment } from '@epinfresh/payment'
import { confirmOrderPayment } from '@epinfresh/payment-confirm'
import { reduceProductStock } from '@epinfresh/product'
import { createRedisClient, type Redis } from '@epinfresh/redis'
import { flushTestRedis } from '@epinfresh/redis/testing'
import { createLogger, hashPassword } from '@epinfresh/shared'
import { getTestEnv } from '@epinfresh/shared/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { type AdminAppOptions } from './deps'
import { type App, buildApp } from './index'

const env = getTestEnv()

let app: App
let db: Db
let redis: Redis
let api: ReturnType<typeof treaty<typeof app>>

function createTestDeps(deps: { db: Db; redis: Redis }): AdminAppOptions {
  return {
    ...deps,
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
  app = buildApp(createTestDeps({ db, redis }))
  api = treaty<typeof app>(app)
})

afterAll(async () => {
  await Promise.allSettled([closeDb(db), redis.quit()])
})

beforeEach(async () => {
  await resetDb(db)
  await flushTestRedis()
})

async function seedUser(email: string, role: 'customer' | 'admin') {
  const passwordHash = await hashPassword('password123')
  const [user] = await db
    .insert(schema.users)
    .values({ name: email.split('@')[0], email, passwordHash, role })
    .returning()
  return user
}

async function seedOrderWithStock(email: string, quantity = 2, stock = 10) {
  const user = await seedUser(email, 'customer')
  const [product] = await db
    .insert(schema.products)
    .values({ name: 'Apple', slug: 'apple', status: 'published' })
    .returning()
  const [sku] = await db
    .insert(schema.productSkus)
    .values({ productId: product.id, name: '1kg', skuCode: 'APPLE-1KG', price: '5.00', stock })
    .returning()
  const [address] = await db
    .insert(schema.addresses)
    .values({
      userId: user.id,
      recipientName: 'Alice',
      phone: '13800000000',
      address: 'Shanghai Pudong',
    })
    .returning()
  const order = await createOrderRecord(
    db,
    user.id,
    [{ skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity }],
    {
      addressId: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      address: address.address,
    },
  )
  await reduceProductStock(sku.id, quantity, db)
  return { user, sku, order }
}

async function skuStock(skuId: string) {
  const [sku] = await db.select().from(schema.productSkus).where(eq(schema.productSkus.id, skuId))
  return Number(sku.stock)
}

async function login(email: string): Promise<{ status: number; cookie: string }> {
  const res = await api.auth.login.post({ email, password: 'password123' })
  return {
    status: res.status,
    cookie: (new Headers(res.headers as Headers).get('set-cookie') ?? '').split(';')[0],
  }
}

async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return `${value}.${Buffer.from(digest).toString('base64').replace(/=+$/, '')}`
}

async function forgeSessionCookie(userId: string, role: 'customer' | 'admin'): Promise<string> {
  const client = createRedisClient(env.TESTING_REDIS_URL)
  const sessionId = crypto.randomUUID()
  try {
    await client.set(`session:${sessionId}`, JSON.stringify({ userId, role }), 'EX', 86400)
  } finally {
    await client.quit()
  }
  return `session_id=${await signCookieValue(sessionId, env.TESTING_SESSION_SECRET)}`
}

describe('auth', () => {
  test('admin login succeeds and sets a session', async () => {
    await seedUser('admin@example.com', 'admin')
    const { status, cookie } = await login('admin@example.com')
    expect(status).toBe(200)
    expect(cookie).not.toBe('')

    const me = await api.auth.me.get({ fetch: { headers: { cookie } } })
    expect(me.status).toBe(200)
    if (me.error !== null) throw me.error
    expect(me.data.role).toBe('admin')
    expect('passwordHash' in me.data).toBe(false)
  })

  test('customer login is rejected with 403', async () => {
    await seedUser('alice@example.com', 'customer')
    const res = await api.auth.login.post({ email: 'alice@example.com', password: 'password123' })
    expect(res.status).toBe(403)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'FORBIDDEN' })
  })

  test('rate limits login attempts with 429', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await api.auth.login.post({ email: 'x@example.com', password: 'wrong' })
      expect(res.status).toBe(401)
    }
    const blocked = await api.auth.login.post({ email: 'x@example.com', password: 'wrong' })
    expect(blocked.status).toBe(429)
    if (blocked.error === null) throw new Error('expected error response')
    expect(blocked.error.value).toMatchObject({ error: 'RATE_LIMITED' })
  })
})

describe('admin guard', () => {
  test('unauthenticated request is rejected with 401', async () => {
    const res = await api.admin.users.get({ query: { page: 1, pageSize: 10 } })
    expect(res.status).toBe(401)
  })

  test('customer session is rejected with 403', async () => {
    const user = await seedUser('alice@example.com', 'customer')
    const cookie = await forgeSessionCookie(user.id, 'customer')
    const res = await api.admin.users.get({
      query: { page: 1, pageSize: 10 },
      fetch: { headers: { cookie } },
    })
    expect(res.status).toBe(403)
  })

  test('admin session can list users without passwordHash', async () => {
    await seedUser('admin@example.com', 'admin')
    await seedUser('alice@example.com', 'customer')
    const { cookie } = await login('admin@example.com')

    const res = await api.admin.users.get({
      query: { page: 1, pageSize: 10 },
      fetch: { headers: { cookie } },
    })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.total).toBe(2)
    for (const row of res.data.items) expect('passwordHash' in row).toBe(false)
  })
})

describe('admin user management', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    return (await login('admin@example.com')).cookie
  }

  test('disables a user and kicks their sessions', async () => {
    const cookie = await adminCookie()
    const user = await seedUser('bob@example.com', 'customer')

    // bob 的会话 (customer 角色走 /auth/me 只要求 isAuth, 可作会话存活性探针)
    const bobCookie = await forgeSessionCookie(user.id, 'customer')
    const before = await api.auth.me.get({ fetch: { headers: { cookie: bobCookie } } })
    expect(before.status).toBe(200)

    const res = await api.admin
      .users({ id: user.id })
      .patch({ isActive: false } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)

    const after = await api.auth.me.get({ fetch: { headers: { cookie: bobCookie } } })
    expect(after.status).toBe(401)
  })

  test('updates role to admin', async () => {
    const cookie = await adminCookie()
    const user = await seedUser('carol@example.com', 'customer')

    const res = await api.admin
      .users({ id: user.id })
      .patch({ role: 'admin' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.role).toBe('admin')
  })

  test('rejects modifying own account with 400', async () => {
    const admin = await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')

    const res = await api.admin
      .users({ id: admin.id })
      .patch({ role: 'customer' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown user', async () => {
    const cookie = await adminCookie()
    const res = await api.admin
      .users({ id: '00000000-0000-4000-8000-000000000000' })
      .patch({ isActive: false } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(404)
  })
})

describe('order status transitions', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    return cookie
  }

  test('updates a pending order to paid', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await api.admin
      .orders({ id: order.id })
      .status.patch({ status: 'paid' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('paid')
  })

  test('cancelling a pending order restores stock', async () => {
    const cookie = await adminCookie()
    const { order, sku } = await seedOrderWithStock('alice@example.com', 2, 10)
    expect(await skuStock(sku.id)).toBe(8)

    const res = await api.admin
      .orders({ id: order.id })
      .status.patch({ status: 'cancelled' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(10)
  })

  test('cancelling a paid order does not restore stock', async () => {
    const cookie = await adminCookie()
    const { order, sku } = await seedOrderWithStock('alice@example.com', 2, 10)
    await updateOrderStatus(order.id, 'paid', db)

    const res = await api.admin
      .orders({ id: order.id })
      .status.patch({ status: 'cancelled' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(8)
  })

  test('rejects an invalid transition with 409', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await api.admin
      .orders({ id: order.id })
      .status.patch({ status: 'completed' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'INVALID_TRANSITION' })
  })

  test('cannot set refunded via the status endpoint', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)
    await updateOrderStatus(order.id, 'paid', db)

    const res = await api.admin
      .orders({ id: order.id })
      .status.patch({ status: 'refunded' } as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(422)
  })

  test('ship sets trackingNumber and shippedAt, and is idempotent for tracking updates', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)
    await updateOrderStatus(order.id, 'paid', db)

    const ship = await api.admin
      .orders({ id: order.id })
      .ship.post({ trackingNumber: 'SF123' }, { fetch: { headers: { cookie } } })
    expect(ship.status).toBe(200)
    if (ship.error !== null) throw ship.error
    expect(ship.data.status).toBe('shipped')
    expect(ship.data.trackingNumber).toBe('SF123')
    expect(ship.data.shippedAt).not.toBeNull()

    const reShip = await api.admin
      .orders({ id: order.id })
      .ship.post({ trackingNumber: 'SF456' }, { fetch: { headers: { cookie } } })
    expect(reShip.status).toBe(200)
    if (reShip.error !== null) throw reShip.error
    expect(reShip.data.status).toBe('shipped')
    expect(reShip.data.trackingNumber).toBe('SF456')
  })

  test('ship rejects a pending order with 409', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await api.admin
      .orders({ id: order.id })
      .ship.post({}, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'INVALID_TRANSITION' })
  })
})

describe('admin refunds', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    return cookie
  }

  test('refunds a paid order and flips both payment and order', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()
    await confirmOrderPayment(payment.id, db)

    const res = await api.admin
      .orders({ id: order.id })
      .refund.post({} as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.status).toBe('refunded')

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(afterOrder.status).toBe('refunded')
  })

  test('refunding an unpaid order is rejected with 409', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await api.admin
      .orders({ id: order.id })
      .refund.post({} as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'INVALID_PAYMENT_STATE' })
  })
})

describe('admin dashboard', () => {
  test('returns zero-filled order status counts', async () => {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)
    await updateOrderStatus(order.id, 'paid', db)

    const res = await api.admin.dashboard.get({ fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.paid).toBe(1)
    expect(res.data.pending).toBe(0)
    expect(res.data.refunded).toBe(0)
    expect(res.data.cancelled).toBe(0)
  })
})

describe('admin payments', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    return cookie
  }

  test('lists payments for an order', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)
    const payment = (
      await initiatePayment(order.id, createMockPaymentGateway(), db)
    )._unsafeUnwrap()
    await confirmOrderPayment(payment.id, db)

    const res = await api.admin
      .orders({ id: order.id })
      .payments.get({ fetch: { headers: { cookie } } })
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].status).toBe('succeeded')
  })

  test('returns 404 for unknown order payments', async () => {
    const cookie = await adminCookie()
    const res = await api.admin
      .orders({ id: '00000000-0000-4000-8000-000000000000' })
      .payments.get({ fetch: { headers: { cookie } } })
    expect(res.status).toBe(404)
  })
})

describe('admin categories', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    return cookie
  }

  async function seedCategory(name: string, slug: string, parentId?: string) {
    const [cat] = await db
      .insert(schema.categories)
      .values(parentId ? { name, slug, parentId } : { name, slug })
      .returning()
    return cat
  }

  test('updates category name, slug, parent and sortOrder', async () => {
    const cookie = await adminCookie()
    const parent = await seedCategory('Food', 'food')
    const child = await seedCategory('Fruit', 'fruit')

    const res = await api.admin
      .categories({ id: child.id })
      .patch(
        { name: 'Fresh Fruit', slug: 'fresh-fruit', parentId: parent.id, sortOrder: 5 },
        { fetch: { headers: { cookie } } },
      )
    expect(res.status).toBe(200)
    if (res.error !== null) throw res.error
    expect(res.data.name).toBe('Fresh Fruit')
    expect(res.data.slug).toBe('fresh-fruit')
    expect(res.data.parentId).toBe(parent.id)
    expect(res.data.sortOrder).toBe(5)
  })

  test('rejects setting a descendant as parent with 409', async () => {
    const cookie = await adminCookie()
    const parent = await seedCategory('Food', 'food')
    const child = await seedCategory('Fruit', 'fruit', parent.id)

    const res = await api.admin
      .categories({ id: parent.id })
      .patch({ parentId: child.id }, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'CATEGORY_CYCLE' })
  })

  test('returns 404 for unknown category', async () => {
    const cookie = await adminCookie()
    const res = await api.admin
      .categories({ id: '00000000-0000-4000-8000-000000000000' })
      .patch({ name: 'Ghost' }, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(404)
    if (res.error === null) throw new Error('expected error response')
    expect(res.error.value).toMatchObject({ error: 'CATEGORY_NOT_FOUND' })
  })
})
