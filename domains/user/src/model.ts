import { table } from '@epinfresh/database'
import type { InferModelsMap } from '@epinfresh/shared'
import Elysia, { t } from 'elysia'

export const userModel = new Elysia().model({
  RegisterInput: t.Object({
    name: t.String(),
    email: t.String({ format: 'email' }),
    password: t.String({ minLength: 6 }),
    phone: t.Optional(t.String()),
  }),

  LoginInput: t.Object({
    email: t.String({ format: 'email' }),
    password: t.String(),
  }),

  UserResponse: t.Omit(table.select.user, ['passwordHash']),
})

export type UserModel = InferModelsMap<typeof userModel>
