import type { ErrorContract } from '@epinfresh/shared'

export const PRODUCT_ERRORS = {
  PRODUCT_NOT_FOUND: { status: 404, message: 'Product not found' },
  SKU_NOT_FOUND: { status: 404, message: 'SKU not found' },
  INSUFFICIENT_STOCK: { status: 409, message: 'Insufficient stock' },
  CATEGORY_NOT_FOUND: { status: 404, message: 'Category not found' },
  CATEGORY_HAS_PRODUCTS: { status: 409, message: 'Category still has products' },
} as const satisfies ErrorContract<
  | 'PRODUCT_NOT_FOUND'
  | 'SKU_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_HAS_PRODUCTS'
>
