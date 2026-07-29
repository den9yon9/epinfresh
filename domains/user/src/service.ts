import { type DbClient, db as defaultDb, schema } from '@epinfresh/database'
import { type Result, err, hashPassword, ok, verifyPassword } from '@epinfresh/shared'
import { count, eq } from 'drizzle-orm'
import type { UserModel } from './model'

let dummyHash: string | null = null

async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await hashPassword('epinfresh-dummy')
  }
  return dummyHash
}

export async function registerUser(input: UserModel['RegisterInput'], db: DbClient = defaultDb) {
  const passwordHash = await hashPassword(input.password)
  const [user] = await db
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash,
      phone: input.phone ?? null,
    })
    .returning()
  return user
}

export async function loginUser(input: UserModel['LoginInput'], db: DbClient = defaultDb) {
  const email = input.email
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
  if (!user) {
    await verifyPassword(input.password, await getDummyHash())
    return err('LOGIN_FAILED')
  }
  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) return err('LOGIN_FAILED')
  const { passwordHash: _, ...safeUser } = user
  return ok(safeUser)
}

export async function getUserById(id: string, db: DbClient = defaultDb) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  if (!user) return err('USER_NOT_FOUND')
  return ok(user)
}

export async function listUsers(opts: UserModel['UserListQuery'], db: DbClient = defaultDb) {
  const { page, pageSize } = opts
  const offset = (page - 1) * pageSize
  const rows = await db
    .select()
    .from(schema.users)
    .orderBy(schema.users.createdAt)
    .limit(pageSize)
    .offset(offset)
  const [{ total }] = await db.select({ total: count() }).from(schema.users)
  return { items: rows, total: Number(total), page, pageSize }
}
