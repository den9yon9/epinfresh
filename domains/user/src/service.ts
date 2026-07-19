import { db, schema } from '@epinfresh/database'
import { eq } from 'drizzle-orm'
import { status } from 'elysia'
import type { UserModel } from './model'

function toDTO(user: typeof schema.users.$inferSelect): UserModel['UserResponse'] {
  const { passwordHash, ...rest } = user
  return rest
}

export abstract class UserService {
  static async register(input: UserModel['RegisterInput']) {
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, input.email))
    if (existing.length > 0) return status(409, 'Email already exists')

    const passwordHash = await Bun.password.hash(input.password)

    const [user] = await db
      .insert(schema.users)
      .values({ name: input.name, email: input.email, passwordHash, phone: input.phone ?? null })
      .returning()

    return toDTO(user)
  }

  static async login(input: { email: string; password: string }): Promise<
    UserModel['UserResponse'] | null
  > {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email))
    if (!user) return null

    const valid = await Bun.password.verify(input.password, user.passwordHash)
    if (!valid) return null

    return toDTO(user)
  }

  static async getById(id: string): Promise<UserModel['UserResponse'] | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
    return user ? toDTO(user) : null
  }

  static async list(): Promise<UserModel['UserResponse'][]> {
    const result = await db.select().from(schema.users)
    return result.map(toDTO)
  }
}
