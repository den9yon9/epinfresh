import { table } from '@epinfresh/database'
import { PaginatedResponse, PaginationQuery } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

export const UserResponseSchema = Type.Omit(table.select.user, ['passwordHash'])

export const RegisterInputSchema = Type.Intersect([
  Type.Omit(table.insert.user, ['id', 'passwordHash', 'role', 'avatar', 'createdAt', 'updatedAt']),
  Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    password: Type.String({ minLength: 8 }),
  }),
])

const emailTransform = Type.Transform(Type.String({ format: 'email', maxLength: 255 }))
  .Decode((v: string) => v.toLowerCase().trim())
  .Encode((v: string) => v)

export const LoginInputSchema = Type.Object({
  email: emailTransform,
  password: Type.String(),
})

export const UserListResponseSchema = PaginatedResponse(UserResponseSchema)
export const UserListQuerySchema = PaginationQuery
