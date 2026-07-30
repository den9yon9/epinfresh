import { db, schema } from '@epinfresh/database'
import { type Result, err, hashPassword, ok, verifyPassword } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { count, eq } from 'drizzle-orm'
import type { LoginInputSchema, RegisterInputSchema, UserListQuerySchema } from './model'

let dummyHash: string | null = null

async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await hashPassword('epinfresh-dummy')
  }
  return dummyHash
}

export async function registerUser(input: Static<typeof RegisterInputSchema>) {
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

export async function loginUser(input: Static<typeof LoginInputSchema>) {
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

export async function getUserById(id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  if (!user) return err('USER_NOT_FOUND')
  return ok(user)
}

export async function listUsers(opts: Static<typeof UserListQuerySchema>) {
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
