import { Type } from '@sinclair/typebox'
import {
  createInsertSchema as insert,
  createSelectSchema as select,
  createUpdateSchema as update,
} from 'drizzle-typebox'
import * as schema from './schema'

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
      email: Type.String({ format: 'email', maxLength: 255 }),
      name: Type.String({ minLength: 1, maxLength: 255 }),
      phone: Type.Optional(Type.String({ maxLength: 50 })),
    }),
    category: insert(schema.categories, {
      parentId: Type.Optional(Type.String()),
    }),
    product: insert(schema.products, {
      images: Type.Array(Type.String()),
      description: Type.Optional(Type.String()),
      categoryId: Type.Optional(Type.String()),
    }),
    productSku: insert(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
  },
  update: {
    user: update(schema.users),
    category: update(schema.categories),
    product: update(schema.products, {
      images: Type.Array(Type.String()),
      description: Type.Optional(Type.String()),
      categoryId: Type.Optional(Type.String()),
    }),
    productSku: update(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
  },
}
