import { db, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import { eq } from 'drizzle-orm'

export type UserDTO = {
  id: string
  name: string | null
  email: string
  phone: string | null
  avatar: string | null
  role: 'customer' | 'admin'
  createdAt: Date
  updatedAt: Date
}

function toDTO(user: typeof schema.users.$inferSelect): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    role: user.role as 'customer' | 'admin',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

const HASH_ALGO = 'argon2id' as const
const DUMMY_HASH = await Bun.password.hash('epinfresh-dummy', HASH_ALGO)

export class UserService {
  static async register(input: {
    name: string
    email: string
    password: string
    phone?: string
  }): Promise<UserDTO> {
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
    return toDTO(user)
  }

  static async login(input: { email: string; password: string }): Promise<
    Result<UserDTO, 'LOGIN_FAILED'>
  > {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email))
    if (!user) {
      await Bun.password.verify(input.password, DUMMY_HASH, HASH_ALGO)
      return err('LOGIN_FAILED')
    }
    const valid = await Bun.password.verify(input.password, user.passwordHash, HASH_ALGO)
    if (!valid) return err('LOGIN_FAILED')
    return ok(toDTO(user))
  }

  static async getById(id: string): Promise<Result<UserDTO, 'USER_NOT_FOUND'>> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
    if (!user) return err('USER_NOT_FOUND')
    return ok(toDTO(user))
  }

  static async list(opts: { page?: number; pageSize?: number } = {}): Promise<UserDTO[]> {
    const page = opts.page ?? 1
    const pageSize = Math.min(opts.pageSize ?? 20, 100)
    const offset = (page - 1) * pageSize
    const rows = await db
      .select()
      .from(schema.users)
      .orderBy(schema.users.createdAt)
      .limit(pageSize)
      .offset(offset)
    return rows.map(toDTO)
  }
}
