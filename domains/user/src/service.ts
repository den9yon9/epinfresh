import { db, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import { eq } from 'drizzle-orm'

const HASH_ALGO = 'argon2id' as const
const DUMMY_HASH = await Bun.password.hash('epinfresh-dummy', HASH_ALGO)

export class UserService {
  static async register(input: {
    name: string
    email: string
    password: string
    phone?: string
  }) {
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

  static async login(input: { email: string; password: string }) {
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

  static async list(opts: { page?: number; pageSize?: number } = {}) {
    const page = opts.page ?? 1
    const pageSize = Math.min(opts.pageSize ?? 20, 100)
    const offset = (page - 1) * pageSize
    const rows = await db
      .select()
      .from(schema.users)
      .orderBy(schema.users.createdAt)
      .limit(pageSize)
      .offset(offset)
    return rows.map(({ passwordHash: _, ...safe }) => safe)
  }
}
