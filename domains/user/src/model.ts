import { emailSchema, table } from '@epinfresh/database'
import { PaginatedResponse, PaginationQuery } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

export const UserResponseSchema = table.select.user

export const RegisterInputSchema = Type.Intersect([
  Type.Omit(table.insert.user, ['id', 'passwordHash', 'role', 'avatar', 'createdAt', 'updatedAt']),
  Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    password: Type.String({ minLength: 8 }),
  }),
])

export const LoginInputSchema = Type.Object({
  email: emailSchema,
  password: Type.String(),
})

export const UserListResponseSchema = PaginatedResponse(UserResponseSchema)
export const UserListQuerySchema = PaginationQuery
