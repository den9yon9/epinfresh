import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { createOrderRecord, updateOrderStatus } from '@epinfresh/order'
import { reduceProductStock } from '@epinfresh/product'
import { createRedisClient } from '@epinfresh/redis'
import { flushTestRedis } from '@epinfresh/redis/testing'
import { hashPassword } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { type App, buildApp, closeInfra } from './index'

let app: App
let db: Db

beforeAll(async () => {
  app = buildApp()
  db = await prepareTestDb()
})

afterAll(async () => {
  await closeInfra()
  await closeDb(db)
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
  const order = await createOrderRecord(db, user.id, [
    { skuId: sku.id, productName: 'Apple', skuName: '1kg', unitPrice: '5.00', quantity },
  ])
  await reduceProductStock(sku.id, quantity, db)
  return { user, sku, order }
}

async function skuStock(skuId: string) {
  const [sku] = await db.select().from(schema.productSkus).where(eq(schema.productSkus.id, skuId))
  return Number(sku.stock)
}

function sessionCookie(setCookie: string[]): string | null {
  const raw = setCookie.find((c) => c.startsWith('session_id='))
  if (!raw) return null
  return raw.split(';')[0]
}

async function login(
  email: string,
): Promise<{ status: number; cookie: string | null; body: unknown }> {
  const res = await app.handle(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    }),
  )
  return {
    status: res.status,
    cookie: sessionCookie(res.headers.getSetCookie()),
    body: await res.json(),
  }
}

async function forgeSessionCookie(userId: string, role: 'customer' | 'admin'): Promise<string> {
  const redis = createRedisClient(process.env.REDIS_URL!)
  const sessionId = crypto.randomUUID()
  try {
    await redis.set(`session:${sessionId}`, JSON.stringify({ userId, role }), 'EX', 86400)
  } finally {
    await redis.quit()
  }
  return `session_id=${sessionId}`
}

describe('auth', () => {
  test('admin login succeeds and sets a session', async () => {
    await seedUser('admin@example.com', 'admin')
    const { status, cookie, body } = await login('admin@example.com')
    expect(status).toBe(200)
    expect(cookie).not.toBeNull()
    expect((body as { role: string }).role).toBe('admin')
    expect('passwordHash' in (body as object)).toBe(false)
  })

  test('customer login is rejected with 403', async () => {
    await seedUser('alice@example.com', 'customer')
    const { status, body } = await login('alice@example.com')
    expect(status).toBe(403)
    expect((body as { error: string }).error).toBe('FORBIDDEN')
  })
})

describe('admin guard', () => {
  test('unauthenticated request is rejected with 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/admin/users?page=1&pageSize=10'),
    )
    expect(res.status).toBe(401)
  })

  test('customer session is rejected with 403', async () => {
    const user = await seedUser('alice@example.com', 'customer')
    const cookie = await forgeSessionCookie(user.id, 'customer')
    const res = await app.handle(
      new Request('http://localhost/api/v1/admin/users?page=1&pageSize=10', {
        headers: { cookie },
      }),
    )
    expect(res.status).toBe(403)
  })

  test('admin session can list users without passwordHash', async () => {
    await seedUser('admin@example.com', 'admin')
    await seedUser('alice@example.com', 'customer')
    const { cookie } = await login('admin@example.com')

    const res = await app.handle(
      new Request('http://localhost/api/v1/admin/users?page=1&pageSize=10', {
        headers: { cookie: cookie! },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: number; items: object[] }
    expect(body.total).toBe(2)
    for (const row of body.items) expect('passwordHash' in row).toBe(false)
  })
})

describe('order status transitions', () => {
  async function adminCookie(): Promise<string> {
    await seedUser('admin@example.com', 'admin')
    const { cookie } = await login('admin@example.com')
    return cookie!
  }

  test('updates a pending order to paid', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await app.handle(
      new Request(`http://localhost/api/v1/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'paid' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('paid')
  })

  test('cancelling a pending order restores stock', async () => {
    const cookie = await adminCookie()
    const { order, sku } = await seedOrderWithStock('alice@example.com', 2, 10)
    expect(await skuStock(sku.id)).toBe(8)

    const res = await app.handle(
      new Request(`http://localhost/api/v1/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(10)
  })

  test('cancelling a paid order does not restore stock', async () => {
    const cookie = await adminCookie()
    const { order, sku } = await seedOrderWithStock('alice@example.com', 2, 10)
    await updateOrderStatus(order.id, 'paid', db)

    const res = await app.handle(
      new Request(`http://localhost/api/v1/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('cancelled')
    expect(await skuStock(sku.id)).toBe(8)
  })

  test('rejects an invalid transition with 409', async () => {
    const cookie = await adminCookie()
    const { order } = await seedOrderWithStock('alice@example.com', 2, 10)

    const res = await app.handle(
      new Request(`http://localhost/api/v1/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'completed' }),
      }),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_TRANSITION')
  })
})
