import { db } from '@epinfresh/database'
import { ProductService } from '@epinfresh/product'
import { type Result, err, ok } from '@epinfresh/shared'

export interface CheckoutInput {
  userId: string
  skuId: string
  quantity: number
}

export async function checkoutWorkflow(
  input: CheckoutInput,
): Promise<Result<{ success: boolean }, string>> {
  return db.transaction(async (tx) => {
    const stockRes = await ProductService.reduceStock(input.skuId, input.quantity, tx)
    if (stockRes.isErr()) return err(stockRes.error)

    return ok({ success: true })
  })
}
