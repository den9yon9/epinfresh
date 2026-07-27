import { type DbClient, db, schema } from '@epinfresh/database'
import { emailQueue } from '@epinfresh/queue'
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

export const createUserService = (client: DbClient = db) => {
  const service = {
    async register(input: UserModel['RegisterInput']) {
      const passwordHash = await hashPassword(input.password)
      const [user] = await client
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
      await emailQueue.add('send-welcome-email', {
        type: 'welcome',
        to: user.email,
        payload: { userId: user.id, name: user.name },
      })
      return user
    },

    async login(input: UserModel['LoginInput']) {
      const email = input.email.toLowerCase().trim()
      const [user] = await client
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
        await verifyPassword(input.password, await getDummyHash())
        return err('LOGIN_FAILED')
      }
      const valid = await verifyPassword(input.password, user.passwordHash)
      if (!valid) return err('LOGIN_FAILED')
      const { passwordHash: _, ...safeUser } = user
      return ok(safeUser)
    },

    async getById(id: string) {
      const [user] = await client
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
    },

    async list(opts: UserModel['UserListQuery']) {
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
      const rows = await client
        .select(columns)
        .from(schema.users)
        .orderBy(schema.users.createdAt)
        .limit(pageSize)
        .offset(offset)
      const [{ total }] = await client.select({ total: count() }).from(schema.users)
      return { items: rows, total: Number(total), page, pageSize }
    },
  }

  return service
}

export const userService = createUserService(db)
export type UserService = ReturnType<typeof createUserService>
