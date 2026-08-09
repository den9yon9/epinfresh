import { treaty } from '@elysiajs/eden'
import type { App } from '@epinfresh/admin-api'

// ponytail: 与 storefront-web 同款: base 必须是完整 URL, 同源 cookie 透传
export const api = treaty<App>(window.location.origin)
