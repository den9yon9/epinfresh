import { productAdminPlugin } from '@epinfresh/product'
import { env } from '@epinfresh/shared'
import type { InferModelsMap } from '@epinfresh/shared'
import { userAdminPlugin } from '@epinfresh/user'
import { Elysia } from 'elysia'

const port = Number(env.ADMIN_PORT)

const app = new Elysia()
  .get('/health', () => ({ status: 'ok', service: 'admin' }))
  .use(userAdminPlugin)
  .use(productAdminPlugin)
  .listen(port)

console.log(`Admin API running at http://localhost:${port}`)

export type App = typeof app
export type AdminModels = InferModelsMap<App>
