import { db, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import { count, eq } from 'drizzle-orm'
import type { UserModel } from './model'

const HASH_ALGO = 'argon2id' as const
const DUMMY_HASH = await Bun.password.hash('epinfresh-dummy', HASH_ALGO)

export class UserService {
  static async register(input: UserModel['RegisterInput']) {
    const passwordHash = await Bun.password.hash(input.password, HASH_ALGO)
    const [user] = await db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash,
        phone: input.phone ?? null,
      })
      .returning()
    const { passwordHash: _, ...safeUser } = user
    return safeUser
  }

  static async login(input: UserModel['LoginInput']) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email))
    if (!user) {
      await Bun.password.verify(input.password, DUMMY_HASH, HASH_ALGO)
      return err('LOGIN_FAILED')
    }
    const valid = await Bun.password.verify(input.password, user.passwordHash, HASH_ALGO)
    if (!valid) return err('LOGIN_FAILED')
    const { passwordHash: _, ...safeUser } = user
    return ok(safeUser)
  }

  static async getById(id: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
    if (!user) return err('USER_NOT_FOUND')
    const { passwordHash: _, ...safeUser } = user
    return ok(safeUser)
  }

  static async list(opts: UserModel['UserListQuery']) {
    const { page, pageSize } = opts
    const offset = (page - 1) * pageSize
    const rows = await db
      .select()
      .from(schema.users)
      .orderBy(schema.users.createdAt)
      .limit(pageSize)
      .offset(offset)
    const [{ total }] = await db.select({ total: count() }).from(schema.users)
    const items = rows.map(({ passwordHash: _, ...safe }) => safe)
    return { items, total: Number(total), page, pageSize }
  }
}
