import { table } from '@epinfresh/database'
import {
  type InferModelsMap,
  PaginatedResponse,
  PaginationQuery,
  type UserRole,
} from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

const UserResponseSchema = t.Omit(table.select.user, ['passwordHash'])

export const userModel = new Elysia({ name: 'user-model' }).model({
  RegisterInput: t.Intersect([
    t.Omit(table.insert.user, ['id', 'passwordHash', 'role', 'avatar', 'createdAt', 'updatedAt']),
    t.Object({
      name: t.String({ minLength: 1, maxLength: 255 }),
      password: t.String({ minLength: 8 }),
    }),
  ]),

  LoginInput: t.Object({
    email: t
      .Transform(t.String({ format: 'email' }))
      .Decode((v) => v.toLowerCase().trim())
      .Encode((v) => v),
    password: t.String(),
  }),

  UserResponse: UserResponseSchema,
  UserListResponse: PaginatedResponse(UserResponseSchema),
  UserListQuery: PaginationQuery,
})

export type UserModel = InferModelsMap<typeof userModel>
export type { UserRole }
