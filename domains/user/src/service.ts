import { db, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import { count, eq } from 'drizzle-orm'
import type { UserModel } from './model'

const HASH_ALGO = 'argon2id' as const

let dummyHash: string | null = null

async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await Bun.password.hash('epinfresh-dummy', HASH_ALGO)
  }
  return dummyHash
}

export class UserService {
  static async register(input: UserModel['RegisterInput']) {
    const passwordHash = await Bun.password.hash(input.password, HASH_ALGO)
    const [user] = await db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email.toLowerCase().trim(),
        passwordHash,
        phone: input.phone ?? null,
      })
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        avatar: schema.users.avatar,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
    return user
  }

  static async login(input: UserModel['LoginInput']) {
    const email = input.email.toLowerCase().trim()
    const [user] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        avatar: schema.users.avatar,
        role: schema.users.role,
        passwordHash: schema.users.passwordHash,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
    if (!user) {
      await Bun.password.verify(input.password, await getDummyHash(), HASH_ALGO)
      return err('LOGIN_FAILED')
    }
    const valid = await Bun.password.verify(input.password, user.passwordHash, HASH_ALGO)
    if (!valid) return err('LOGIN_FAILED')
    const { passwordHash: _, ...safeUser } = user
    return ok(safeUser)
  }

  static async getById(id: string) {
    const [user] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        avatar: schema.users.avatar,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
    if (!user) return err('USER_NOT_FOUND')
    return ok(user)
  }

  static async list(opts: UserModel['UserListQuery']) {
    const { page, pageSize } = opts
    const offset = (page - 1) * pageSize
    const columns = {
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phone: schema.users.phone,
      avatar: schema.users.avatar,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    } as const
    const rows = await db
      .select(columns)
      .from(schema.users)
      .orderBy(schema.users.createdAt)
      .limit(pageSize)
      .offset(offset)
    const [{ total }] = await db.select({ total: count() }).from(schema.users)
    return { items: rows, total: Number(total), page, pageSize }
  }
}
