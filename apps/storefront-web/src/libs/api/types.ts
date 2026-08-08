import type { api } from './client'
import type { EdenListItem } from './eden-types'

export type Product = EdenListItem<typeof api.products.get>
export type Category = EdenListItem<typeof api.categories.get>
