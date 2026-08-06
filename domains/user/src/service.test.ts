import { closeDb, type Db } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { getUserById, loginUser, registerUser } from './service'

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

describe('registerUser', () => {
  test('creates user with hashed password', async () => {
    const user = await registerUser(
      { name: 'Alice', email: 'alice@example.com', password: 'secret123' },
      db,
    )
    expect(user.email).toBe('alice@example.com')
    expect(user.passwordHash).not.toBe('secret123')
  })

  test('rejects duplicate email', async () => {
    await registerUser({ name: 'Alice', email: 'a@example.com', password: 'secret123' }, db)
    expect(
      registerUser({ name: 'Bob', email: 'a@example.com', password: 'secret123' }, db),
    ).rejects.toThrow()
  })
})

describe('loginUser', () => {
  test('returns user on valid credentials', async () => {
    await registerUser({ name: 'Alice', email: 'a@example.com', password: 'secret123' }, db)
    const result = await loginUser({ email: 'a@example.com', password: 'secret123' }, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().email).toBe('a@example.com')
  })

  test('returns LOGIN_FAILED on wrong password', async () => {
    await registerUser({ name: 'Alice', email: 'a@example.com', password: 'secret123' }, db)
    const result = await loginUser({ email: 'a@example.com', password: 'wrong-pass' }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('LOGIN_FAILED')
  })

  test('returns LOGIN_FAILED for unknown email', async () => {
    const result = await loginUser({ email: 'nobody@example.com', password: 'secret123' }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('LOGIN_FAILED')
  })
})

describe('getUserById', () => {
  test('returns USER_NOT_FOUND for missing user', async () => {
    const result = await getUserById('00000000-0000-4000-8000-000000000000', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('USER_NOT_FOUND')
  })

  test('finds registered user', async () => {
    const { id } = await registerUser(
      { name: 'Alice', email: 'a@example.com', password: 'secret123' },
      db,
    )
    const result = await getUserById(id, db)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().email).toBe('a@example.com')
  })
})
