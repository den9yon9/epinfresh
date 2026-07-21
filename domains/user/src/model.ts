import { type InferModelsMap, USER_ROLE, type UserRole } from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

export const userModel = new Elysia().model({
  RegisterInput: t.Object({
    name: t.String({ minLength: 1, maxLength: 255 }),
    email: t.String({ format: 'email' }),
    password: t.String({ minLength: 8 }),
    phone: t.Optional(t.String({ maxLength: 50 })),
  }),

  LoginInput: t.Object({
    email: t.String({ format: 'email' }),
    password: t.String(),
  }),

  UserResponse: t.Object({
    id: t.String({ format: 'uuid' }),
    name: t.Union([t.String(), t.Null()]),
    email: t.String({ format: 'email' }),
    phone: t.Union([t.String(), t.Null()]),
    avatar: t.Union([t.String(), t.Null()]),
    role: t.Union(USER_ROLE.map((r) => t.Literal(r))),
    createdAt: t.Date(),
    updatedAt: t.Date(),
  }),

  Empty: t.Object({}),
})

export type UserModel = InferModelsMap<typeof userModel>
export type { UserRole }
