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
    product: select(schema.products),
    productSku: select(schema.productSkus),
  },
  insert: {
    user: insert(schema.users),
    category: insert(schema.categories),
    product: insert(schema.products),
    productSku: insert(schema.productSkus),
  },
  update: {
    user: update(schema.users),
    category: update(schema.categories),
    product: update(schema.products),
    productSku: update(schema.productSkus),
  },
}
