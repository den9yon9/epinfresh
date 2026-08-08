import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { count, eq } from 'drizzle-orm'

import {
  createAddress,
  deleteAddress,
  getAddressById,
  listAddressesByUser,
  updateAddress,
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

async function seedUser(email = 'alice@example.com') {
  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Alice', email, passwordHash: 'not-a-real-hash' })
    .returning()
  return user
}

async function addressCount() {
  const [{ total }] = await db.select({ total: count() }).from(schema.addresses)
  return Number(total)
}

describe('createAddress', () => {
  test('creates an address and makes the first one default', async () => {
    const user = await seedUser()
    const address = await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '13800000000', address: 'Shanghai Pudong' },
      db,
    )
    expect(address.userId).toBe(user.id)
    expect(address.isDefault).toBe(true)
  })

  test('only one default per user', async () => {
    const user = await seedUser()
    await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '1', address: 'Home', isDefault: true },
      db,
    )
    await createAddress(
      { userId: user.id, recipientName: 'Bob', phone: '2', address: 'Office', isDefault: true },
      db,
    )
    const items = await listAddressesByUser(user.id, db)
    expect(items.items).toHaveLength(2)
    expect(items.items.filter((a) => a.isDefault)).toHaveLength(1)
    expect(items.items[0].isDefault).toBe(true)
  })
})

describe('address queries', () => {
  test('lists only the user own addresses with default first', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '1', address: 'Home' },
      db,
    )
    await createAddress(
      { userId: other.id, recipientName: 'Bob', phone: '2', address: 'Other Home' },
      db,
    )

    const { items } = await listAddressesByUser(user.id, db)
    expect(items).toHaveLength(1)
    expect(items[0].address).toBe('Home')
  })

  test('getAddressById returns ADDRESS_NOT_FOUND for another user address', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const otherAddress = await createAddress(
      { userId: other.id, recipientName: 'Bob', phone: '2', address: 'Other Home' },
      db,
    )

    const result = await getAddressById(user.id, otherAddress.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ADDRESS_NOT_FOUND')
  })
})

describe('updateAddress', () => {
  test('updates fields and switches default', async () => {
    const user = await seedUser()
    const first = await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '1', address: 'Home', isDefault: true },
      db,
    )
    const second = await createAddress(
      { userId: user.id, recipientName: 'Bob', phone: '2', address: 'Office' },
      db,
    )

    const updated = await updateAddress(user.id, second.id, { isDefault: true }, db)
    expect(updated.isOk()).toBe(true)
    expect(updated._unsafeUnwrap().isDefault).toBe(true)

    const { items } = await listAddressesByUser(user.id, db)
    expect(items.find((a) => a.id === first.id)!.isDefault).toBe(false)
    expect(items.find((a) => a.id === second.id)!.isDefault).toBe(true)
  })

  test('rejects updating another user address', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const otherAddress = await createAddress(
      { userId: other.id, recipientName: 'Bob', phone: '2', address: 'Other Home' },
      db,
    )

    const result = await updateAddress(user.id, otherAddress.id, { phone: '99' }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ADDRESS_NOT_FOUND')
  })
})

describe('deleteAddress', () => {
  test('deletes an address and releases the default', async () => {
    const user = await seedUser()
    const address = await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '1', address: 'Home', isDefault: true },
      db,
    )

    const result = await deleteAddress(user.id, address.id, db)
    expect(result.isOk()).toBe(true)
    expect(await addressCount()).toBe(0)
  })

  test('rejects deleting another user address', async () => {
    const user = await seedUser()
    const other = await seedUser('bob@example.com')
    const otherAddress = await createAddress(
      { userId: other.id, recipientName: 'Bob', phone: '2', address: 'Other Home' },
      db,
    )

    const result = await deleteAddress(user.id, otherAddress.id, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ADDRESS_NOT_FOUND')
    expect(await addressCount()).toBe(1)
  })

  test('orders snapshot keeps address data after deletion', async () => {
    const user = await seedUser()
    const address = await createAddress(
      { userId: user.id, recipientName: 'Alice', phone: '1', address: 'Home' },
      db,
    )
    const [order] = await db
      .insert(schema.orders)
      .values({
        userId: user.id,
        totalAmount: '1.00',
        addressId: address.id,
        recipientName: address.recipientName,
        recipientPhone: address.phone,
        shippingAddress: address.address,
      })
      .returning()

    const result = await deleteAddress(user.id, address.id, db)
    expect(result.isOk()).toBe(true)

    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))
    expect(after.addressId).toBeNull()
    expect(after.shippingAddress).toBe('Home')
    expect(after.recipientName).toBe('Alice')
  })
})
