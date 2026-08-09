import type { api } from './client'
import type { EdenBody, EdenData, EdenListItem } from './eden-types'

export type Product = EdenListItem<typeof api.products.get>
export type Category = EdenListItem<typeof api.categories.get>
export type AuthUser = EdenData<typeof api.auth.me.get>
export type CartItem = EdenData<typeof api.cart.get>['items'][number]
export type Address = EdenListItem<typeof api.addresses.get>
export type CheckoutBody = EdenBody<typeof api.orders.post>
