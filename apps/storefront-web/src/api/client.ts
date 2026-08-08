import { treaty } from '@elysiajs/eden'
import type { App } from '@epinfresh/storefront-api'

// ponytail: base 为空串 = 同源请求, 经 vite proxy 直达 storefront API
export const api = treaty<App>('')
