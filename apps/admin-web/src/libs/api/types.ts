import type { api } from './client'
import type { EdenData, EdenListItem } from './eden-types'

export type AdminUser = EdenData<typeof api.auth.me.get>
export type Dashboard = EdenData<typeof api.admin.dashboard.get>
export type Order = EdenListItem<typeof api.admin.orders.get>
