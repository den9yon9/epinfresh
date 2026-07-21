import { db, schema } from '@epinfresh/database'
import {
  type DomainError,
  ResultAsync,
  conflict,
  internal,
  invalidCredentials,
  notFound,
} from '@epinfresh/shared'
import { eq } from 'drizzle-orm'
import type { UserModel } from './model'

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
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

const HASH_ALGO = 'argon2id' as const
const DUMMY_HASH = Bun.password.hashSync('epinfresh-dummy', HASH_ALGO)

interface RegisterInput {
  name: string
  email: string
  password: string
  phone?: string
}

interface LoginInput {
  email: string
  password: string
}

export class UserService {
  static register(input: RegisterInput): ResultAsync<UserDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        const passwordHash = await Bun.password.hash(input.password, HASH_ALGO)
        try {
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
        } catch (rawErr) {
          const code = unwrapPgCode(rawErr)
          if (code === '23505') throw new EmailConflictError()
          throw rawErr
        }
      })(),
      (rawErr) =>
        rawErr instanceof EmailConflictError
          ? conflict('DUPLICATE_EMAIL', 'Email already registered')
          : internal('Failed to register user', rawErr),
    )
  }

  static login(input: LoginInput): ResultAsync<UserDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, input.email))
        if (!user) {
          await Bun.password.verify(input.password, DUMMY_HASH, HASH_ALGO)
          throw new InvalidCredentialsError()
        }
        const valid = await Bun.password.verify(input.password, user.passwordHash, HASH_ALGO)
        if (!valid) throw new InvalidCredentialsError()
        return toDTO(user)
      })(),
      (rawErr) =>
        rawErr instanceof InvalidCredentialsError
          ? invalidCredentials()
          : internal('Failed to login', rawErr),
    )
  }

  static getById(id: string): ResultAsync<UserDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id))
        if (!user) throw new NotFoundError('User', id)
        return toDTO(user)
      })(),
      (rawErr) =>
        rawErr instanceof NotFoundError
          ? notFound('User', id)
          : internal('Failed to fetch user', rawErr),
    )
  }

  static list(
    opts: { page?: number; pageSize?: number } = {},
  ): ResultAsync<UserDTO[], DomainError> {
    const page = opts.page ?? 1
    const pageSize = Math.min(opts.pageSize ?? 20, 100)
    const offset = (page - 1) * pageSize
    return ResultAsync.fromPromise(
      db
        .select()
        .from(schema.users)
        .orderBy(schema.users.createdAt)
        .limit(pageSize)
        .offset(offset)
        .then((rows) => rows.map(toDTO)),
      (rawErr) => internal('Failed to list users', rawErr),
    )
  }
}

class EmailConflictError extends Error {}
class InvalidCredentialsError extends Error {}
class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id?: string,
  ) {
    super(`${entity} not found`)
  }
}

function unwrapPgCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const candidate = err as { code?: unknown }
  return typeof candidate.code === 'string' ? candidate.code : null
}

export type { UserModel }
