import { table } from '@epinfresh/database'
import type { InferModelsMap, UserRole } from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

const UserResponseSchema = t.Omit(table.select.user, ['passwordHash'])

export const userModel = new Elysia().model({
  RegisterInput: t.Intersect([
    t.Omit(table.insert.user, ['id', 'passwordHash', 'role', 'avatar', 'createdAt', 'updatedAt']),
    t.Object({
      name: t.String({ minLength: 1, maxLength: 255 }),
      password: t.String({ minLength: 8 }),
    }),
  ]),

  LoginInput: t.Object({
    email: t.String({ format: 'email' }),
    password: t.String(),
  }),

  UserResponse: UserResponseSchema,
  UserListResponse: t.Array(UserResponseSchema),

  ErrorResponse: t.Object({
    error: t.String(),
    message: t.String(),
  }),

  Empty: t.Object({}),
})

export type UserModel = InferModelsMap<typeof userModel>
export type { UserRole }
