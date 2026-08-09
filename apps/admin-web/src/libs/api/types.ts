import type { api } from './client'
import type { EdenData } from './eden-types'

export type AdminUser = EdenData<typeof api.auth.me.get>
