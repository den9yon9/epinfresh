import { Type } from '@sinclair/typebox'
import {
  createInsertSchema as insert,
  createSelectSchema as select,
  createUpdateSchema as update,
} from 'drizzle-typebox'

import * as schema from './schema'

const userSelect = select(schema.users)

export const emailSchema = Type.Transform(Type.String({ format: 'email', maxLength: 255 }))
  .Decode((v) => v.toLowerCase().trim())
  .Encode((v) => v)

export const table = {
  select: {
    user: Type.Omit(userSelect, ['passwordHash']),
    address: select(schema.addresses),
    cartItem: select(schema.cartItems),
    category: select(schema.categories),
    product: select(schema.products, {
      images: Type.Array(Type.String()),
    }),
    productSku: select(schema.productSkus, {
      attributes: Type.Record(Type.String(), Type.String()),
    }),
    order: select(schema.orders),
    orderItem: select(schema.orderItems),
    payment: select(schema.payments),
    refund: select(schema.refunds),
    checkoutIdempotencyKey: select(schema.checkoutIdempotencyKeys),
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
      attributes: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    order: insert(schema.orders),
    address: insert(schema.addresses, {
      recipientName: Type.String({ minLength: 1, maxLength: 100 }),
      phone: Type.String({ minLength: 1, maxLength: 50 }),
      address: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    orderItem: insert(schema.orderItems),
    payment: insert(schema.payments),
    checkoutIdempotencyKey: insert(schema.checkoutIdempotencyKeys),
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
    order: update(schema.orders),
    address: update(schema.addresses, {
      recipientName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      phone: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
      address: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    }),
    orderItem: update(schema.orderItems),
    payment: update(schema.payments),
  },
}
