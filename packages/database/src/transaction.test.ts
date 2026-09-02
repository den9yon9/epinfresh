import { err, ok } from '@epinfresh/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { closeDb, type Db, schema, withTransaction } from './index'
import { prepareTestDb, resetDb } from './testing'

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

async function seedUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email: 'alice@example.com', passwordHash: 'not-a-real-hash' })
    .returning()
  return user
}

async function insertAddress(
  tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
  userId: string,
) {
  await tx.insert(schema.addresses).values({ userId, recipientName: 'A', phone: '1', address: 'x' })
}

async function addressCount(userId: string) {
  const rows = await db.select().from(schema.addresses).where(eq(schema.addresses.userId, userId))
  return rows.length
}

describe('withTransaction nesting', () => {
  test('reuses the outer transaction instead of opening a new one', async () => {
    const user = await seedUser()
    let innerClientIsOuterTx = false

    const id = await withTransaction(db, async (tx) => {
      return withTransaction(tx, async (tx2) => {
        innerClientIsOuterTx = tx2 === tx
        await insertAddress(tx2, user.id)
        return 'done'
      })
    })

    expect(id).toBe('done')
    expect(innerClientIsOuterTx).toBe(true)
    // 外层提交, 内层写入随之可见
    expect(await addressCount(user.id)).toBe(1)
  })

  test('inner err propagates: outer transaction rolls back as one unit', async () => {
    const user = await seedUser()

    const result = await withTransaction(db, async (tx) => {
      const inner = await withTransaction(tx, async () => err('INNER_FAILURE' as const))
      if (inner.isErr()) return err(inner.error)
      return ok('unreachable' as const)
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('INNER_FAILURE')
    // 尽管内层写入发生在同一事务, 外层整体回滚
    expect(await addressCount(user.id)).toBe(0)
  })

  test('uncaught inner throw propagates and rolls back the outer transaction', async () => {
    const user = await seedUser()

    let threw = false
    try {
      await withTransaction(db, async (tx) => {
        await withTransaction(tx, async () => {
          await insertAddress(tx, user.id)
          throw new Error('boom')
        })
        return ok('unreachable' as const)
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    expect(await addressCount(user.id)).toBe(0)
  })
})
