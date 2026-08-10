import { closeDb, type Db, schema } from '@epinfresh/database'
import { prepareTestDb, resetDb } from '@epinfresh/database/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import {
  consumePasswordResetToken,
  getUserById,
  loginUser,
  registerUser,
  requestPasswordReset,
  updateUser,
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

  test('returns ACCOUNT_DISABLED for disabled user', async () => {
    const user = await registerUser(
      { name: 'Bob', email: 'bob@example.com', password: 'secret123' },
      db,
    )
    await updateUser(user.id, { isActive: false }, db)
    const result = await loginUser({ email: 'bob@example.com', password: 'secret123' }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('ACCOUNT_DISABLED')
  })
})

describe('updateUser', () => {
  test('updates role and isActive', async () => {
    const user = await registerUser(
      { name: 'Carol', email: 'carol@example.com', password: 'secret123' },
      db,
    )
    const updated = await updateUser(user.id, { role: 'admin', isActive: false }, db)
    expect(updated.isOk()).toBe(true)
    expect(updated._unsafeUnwrap().role).toBe('admin')
    expect(updated._unsafeUnwrap().isActive).toBe(false)
  })

  test('returns USER_NOT_FOUND for missing user', async () => {
    const result = await updateUser('00000000-0000-4000-8000-000000000000', { isActive: false }, db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('USER_NOT_FOUND')
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

describe('requestPasswordReset / consumePasswordResetToken', () => {
  async function seedUserWithReset(): Promise<{ userId: string; token: string }> {
    const { id } = await registerUser(
      { name: 'Alice', email: 'reset@example.com', password: 'old-password-1' },
      db,
    )
    const result = await requestPasswordReset('reset@example.com', db)
    const { token } = result._unsafeUnwrap()
    return { userId: id, token }
  }

  test('full cycle: token resets password and is single-use', async () => {
    const { token } = await seedUserWithReset()

    const first = await consumePasswordResetToken(token, 'new-password-2', db)
    expect(first.isOk()).toBe(true)

    const loginNew = await loginUser({ email: 'reset@example.com', password: 'new-password-2' }, db)
    expect(loginNew.isOk()).toBe(true)
    const loginOld = await loginUser({ email: 'reset@example.com', password: 'old-password-1' }, db)
    expect(loginOld.isErr()).toBe(true)

    const replay = await consumePasswordResetToken(token, 'another-password-3', db)
    expect(replay.isErr()).toBe(true)
    expect(replay._unsafeUnwrapErr()).toBe('RESET_TOKEN_INVALID')
  })

  test('returns ok for unknown email without creating a token', async () => {
    const result = await requestPasswordReset('ghost@example.com', db)
    expect(result.isOk()).toBe(true)
    const rows = await db.select().from(schema.passwordResetTokens)
    expect(rows.length).toBe(0)
  })

  test('rejects unknown token', async () => {
    const result = await consumePasswordResetToken('f'.repeat(64), 'whatever-1', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('RESET_TOKEN_INVALID')
  })

  test('rejects expired token', async () => {
    const { token } = await seedUserWithReset()
    await db.update(schema.passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) })
    const result = await consumePasswordResetToken(token, 'whatever-1', db)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('RESET_TOKEN_EXPIRED')
  })
})
