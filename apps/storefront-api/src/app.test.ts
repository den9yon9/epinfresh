import { closeDb, type Db, type ProductStatus, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
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

function createTestDeps(deps: {
  db: Db
  redis: Redis
  emailQueue: Queue<SendEmailJobData>
}): StorefrontAppOptions {
  return {
    ...deps,
    sessionSecret: env.TEST_SESSION_SECRET,
    corsOrigin: true,
    trustProxy: false,
    isProduction: false,
    logger: createLogger('silent'),
  }
}

beforeAll(async () => {
  db = await prepareTestDb()
  redis = createRedisClient(env.TEST_REDIS_URL)
  emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl: env.TEST_REDIS_URL })
  app = buildApp(createTestDeps({ db, redis, emailQueue }))
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

function sessionCookie(setCookie: string[]): string | null {
  const raw = setCookie.find((c) => c.startsWith('session_id='))
  if (!raw) return null
  return raw.split(';')[0]
}

function json(body: unknown, cookie?: string | null): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }
}

describe('health', () => {
  test('returns ok with db and redis reachable', async () => {
    const res = await app.handle(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', db: true, redis: true })
  })
})

describe('auth', () => {
  test('register creates a user and never returns passwordHash', async () => {
    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/auth/register',
        json({ name: 'Alice', email: 'a@example.com', password: 'password123' }),
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string }
    expect(body.email).toBe('a@example.com')
    expect('passwordHash' in body).toBe(false)
  })

  test('login sets a session cookie and me returns the user without passwordHash', async () => {
    await seedUser('alice@example.com')
    const login = await app.handle(
      new Request(
        'http://localhost/api/v1/auth/login',
        json({ email: 'alice@example.com', password: 'password123' }),
      ),
    )
    expect(login.status).toBe(200)
    const cookie = sessionCookie(login.headers.getSetCookie())
    expect(cookie).not.toBeNull()

    const me = await app.handle(
      new Request('http://localhost/api/v1/auth/me', { headers: { cookie: cookie! } }),
    )
    expect(me.status).toBe(200)
    const body = (await me.json()) as { email: string }
    expect(body.email).toBe('alice@example.com')
    expect('passwordHash' in body).toBe(false)
  })

  test('login rejects wrong password with 401', async () => {
    await seedUser('alice@example.com')
    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/auth/login',
        json({ email: 'alice@example.com', password: 'wrong-pass' }),
      ),
    )
    expect(res.status).toBe(401)
  })

  test('me returns 401 without a session', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1/auth/me'))
    expect(res.status).toBe(401)
  })

  test('logout clears the session', async () => {
    await seedUser('alice@example.com')
    const login = await app.handle(
      new Request(
        'http://localhost/api/v1/auth/login',
        json({ email: 'alice@example.com', password: 'password123' }),
      ),
    )
    const cookie = sessionCookie(login.headers.getSetCookie())

    const logout = await app.handle(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie: cookie! },
      }),
    )
    expect(logout.status).toBe(204)

    const me = await app.handle(
      new Request('http://localhost/api/v1/auth/me', { headers: { cookie: cookie! } }),
    )
    expect(me.status).toBe(401)
  })
})

describe('orders', () => {
  async function loginCookie(email: string): Promise<string> {
    const login = await app.handle(
      new Request('http://localhost/api/v1/auth/login', json({ email, password: 'password123' })),
    )
    return sessionCookie(login.headers.getSetCookie())!
  }

  test('creates an order and reduces stock', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/orders',
        json({ items: [{ skuId: sku.id, quantity: 3 }] }, cookie),
      ),
    )
    expect(res.status).toBe(201)
    const order = (await res.json()) as { totalAmount: string; items: unknown[] }
    expect(order.totalAmount).toBe('15.00')
    expect(order.items).toHaveLength(1)

    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(7)
  })

  test('returns 404 SKU_NOT_FOUND for unknown sku', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)

    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/orders',
        json({ items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] }, cookie),
      ),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('SKU_NOT_FOUND')
  })

  test('returns 409 INSUFFICIENT_STOCK when quantity exceeds stock', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 2)
    const cookie = await loginCookie(user.email)

    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/orders',
        json({ items: [{ skuId: sku.id, quantity: 5 }] }, cookie),
      ),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('INSUFFICIENT_STOCK')
  })

  test('returns 409 PRODUCT_UNAVAILABLE for a draft product sku', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple-draft', '5.00', 10, 'draft')
    const cookie = await loginCookie(user.email)

    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/orders',
        json({ items: [{ skuId: sku.id, quantity: 1 }] }, cookie),
      ),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('PRODUCT_UNAVAILABLE')
  })

  test('requires authentication', async () => {
    const res = await app.handle(
      new Request(
        'http://localhost/api/v1/orders',
        json({ items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] }),
      ),
    )
    expect(res.status).toBe(401)
  })
})

describe('products', () => {
  test('lists published products only', async () => {
    await seedSku('apple', '5.00', 10, 'published')
    await seedSku('hidden', '5.00', 10, 'draft')

    const res = await app.handle(new Request('http://localhost/api/v1/products?page=1&pageSize=10'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: number; items: { slug: string }[] }
    expect(body.total).toBe(1)
    expect(body.items[0].slug).toBe('apple')
  })
})
