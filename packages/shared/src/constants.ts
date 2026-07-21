export const USER_ROLE = ['customer', 'admin'] as const
export type UserRole = (typeof USER_ROLE)[number]

export const PRODUCT_STATUS = ['draft', 'published', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUS)[number]
