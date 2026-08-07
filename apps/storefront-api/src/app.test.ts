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

function sessionCookie(res: { headers: ResponseInit['headers'] }): string {
  const raw = res.headers as unknown as { get?: (name: string) => string | null } | undefined
  return (raw?.get?.('set-cookie') ?? '').split(';')[0]
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
    expect(res.data?.email).toBe('a@example.com')
    expect('passwordHash' in (res.data as object)).toBe(false)
  })

  test('login sets a session cookie and me returns the user without passwordHash', async () => {
    await seedUser('alice@example.com')
    const login = await api.auth.login.post({ email: 'alice@example.com', password: 'password123' })
    expect(login.status).toBe(200)
    const cookie = sessionCookie(login)
    expect(cookie).not.toBe('')

    const me = await api.auth.me.get({ fetch: { headers: { cookie } } })
    expect(me.status).toBe(200)
    expect(me.data?.email).toBe('alice@example.com')
    expect('passwordHash' in (me.data as object)).toBe(false)
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
})

describe('orders', () => {
  test('creates an order and reduces stock', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 3 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(201)
    expect(res.data?.totalAmount).toBe('15.00')
    expect(res.data?.items).toHaveLength(1)

    const [after] = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.id, sku.id))
    expect(Number(after.stock)).toBe(7)
  })

  test('returns 404 SKU_NOT_FOUND for unknown sku', async () => {
    const user = await seedUser('alice@example.com')
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(404)
    expect(res.error?.value).toMatchObject({ error: 'SKU_NOT_FOUND' })
  })

  test('returns 409 INSUFFICIENT_STOCK when quantity exceeds stock', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 2)
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 5 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(409)
    expect(res.error?.value).toMatchObject({ error: 'INSUFFICIENT_STOCK' })
  })

  test('returns 409 PRODUCT_UNAVAILABLE for a draft product sku', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple-draft', '5.00', 10, 'draft')
    const cookie = await loginCookie(user.email)

    const res = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    expect(res.status).toBe(409)
    expect(res.error?.value).toMatchObject({ error: 'PRODUCT_UNAVAILABLE' })
  })

  test('requires authentication', async () => {
    const res = await api.orders.post({
      items: [{ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    })
    expect(res.status).toBe(401)
  })

  test('same Idempotency-Key returns the same order twice', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)
    const body = { items: [{ skuId: sku.id, quantity: 2 }] }
    const options = { fetch: { headers: { cookie, 'idempotency-key': 'idem-1' } } }

    const first = await api.orders.post(body, options)
    expect(first.status).toBe(201)

    const second = await api.orders.post(body, options)
    expect(second.status).toBe(200)
    expect(second.data?.id).toBe(first.data?.id)

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
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 2 }] },
      { fetch: { headers: { cookie } } },
    )
    const orderId = orderRes.data?.id as string

    const payRes = await api
      .orders({ id: orderId })
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    expect(payRes.status).toBe(201)
    expect(payRes.data?.status).toBe('pending')
    const paymentId = payRes.data?.id as string

    const confirmRes = await api
      .payments({ id: paymentId })
      .confirm.post({} as never, { fetch: { headers: { cookie } } })
    expect(confirmRes.status).toBe(200)
    expect(confirmRes.data?.status).toBe('succeeded')

    const [afterOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    expect(afterOrder.status).toBe('paid')
  })

  test('cannot pay someone else order', async () => {
    await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const alice = await seedUser('bob@example.com')
    const cookie = await loginCookie(alice.email)

    const orderRes = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    const orderId = orderRes.data?.id as string

    const other = await seedUser('carol@example.com')
    const otherCookie = await loginCookie(other.email)
    const res = await api
      .orders({ id: orderId })
      .pay.post({} as never, { fetch: { headers: { cookie: otherCookie } } })
    expect(res.status).toBe(404)
  })

  test('paying a non-pending order is rejected', async () => {
    const user = await seedUser('alice@example.com')
    const { sku } = await seedSku('apple', '5.00', 10)
    const cookie = await loginCookie(user.email)

    const orderRes = await api.orders.post(
      { items: [{ skuId: sku.id, quantity: 1 }] },
      { fetch: { headers: { cookie } } },
    )
    const orderId = orderRes.data?.id as string
    await db.update(schema.orders).set({ status: 'cancelled' }).where(eq(schema.orders.id, orderId))

    const res = await api
      .orders({ id: orderId })
      .pay.post({} as never, { fetch: { headers: { cookie } } })
    expect(res.status).toBe(409)
    expect(res.error?.value).toMatchObject({ error: 'ORDER_NOT_PENDING' })
  })
})

describe('products', () => {
  test('lists published products only', async () => {
    await seedSku('apple', '5.00', 10, 'published')
    await seedSku('hidden', '5.00', 10, 'draft')

    const res = await api.products.get({ query: { page: 1, pageSize: 10 } })
    expect(res.status).toBe(200)
    expect(res.data?.total).toBe(1)
    expect(res.data?.items[0]?.slug).toBe('apple')
  })
})
