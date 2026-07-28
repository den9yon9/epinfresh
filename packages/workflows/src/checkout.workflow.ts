import { db } from '@epinfresh/database'
import { reduceProductStock } from '@epinfresh/product'
import { type Result, ok } from '@epinfresh/shared'

export interface CheckoutInput {
  userId: string
  skuId: string
  quantity: number
}

export async function checkoutWorkflow(input: CheckoutInput): Promise<Result<void, string>> {
  return db.transaction(async (tx) => {
    const stockRes = await reduceProductStock(input.skuId, input.quantity, tx)
    if (stockRes.isErr()) return stockRes
    return ok()
  })
}
