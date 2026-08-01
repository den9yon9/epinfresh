import { Type } from '@sinclair/typebox'
import {
  createInsertSchema as insert,
  createSelectSchema as select,
  createUpdateSchema as update,
} from 'drizzle-typebox'
import * as schema from './schema'

export const emailSchema = Type.Transform(Type.String({ format: 'email', maxLength: 255 }))
  .Decode((v) => v.toLowerCase().trim())
  .Encode((v) => v)

export const table = {
  select: {
    user: select(schema.users),
    category: select(schema.categories),
    product: select(schema.products, {
      images: Type.Array(Type.String()),
    }),
    productSku: select(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
  },
  insert: {
    user: insert(schema.users, {
      email: emailSchema,
      name: Type.String({ minLength: 1, maxLength: 255 }),
      phone: Type.Optional(Type.String({ maxLength: 50 })),
    }),
    category: insert(schema.categories, {
      parentId: Type.Optional(Type.String({ format: 'uuid' })),
    }),
    product: insert(schema.products, {
      images: Type.Array(Type.String()),
      description: Type.Optional(Type.String()),
      categoryId: Type.Optional(Type.String({ format: 'uuid' })),
    }),
    productSku: insert(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
  },
  update: {
    user: update(schema.users, {
      email: Type.Optional(emailSchema),
    }),
    category: update(schema.categories),
    product: update(schema.products, {
      images: Type.Array(Type.String()),
      description: Type.Optional(Type.String()),
      categoryId: Type.Optional(Type.String({ format: 'uuid' })),
    }),
    productSku: update(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
  },
}
