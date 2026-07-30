import { db } from '@epinfresh/database'
import { reduceProductStock } from '@epinfresh/product'
import type { Result } from '@epinfresh/shared'

export interface CheckoutInput {
  userId: string
  skuId: string
  quantity: number
}

// ponytail: placeholder for future order creation; userId will be used then
export async function checkoutWorkflow(
  input: CheckoutInput,
): Promise<Result<void, 'SKU_NOT_FOUND' | 'INSUFFICIENT_STOCK'>> {
  return db.transaction(async (tx) => reduceProductStock(input.skuId, input.quantity, tx))
}
