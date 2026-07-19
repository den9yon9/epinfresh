import { productWWWPlugin } from '@epinfresh/product'
import type { InferModelsMap } from '@epinfresh/shared'
import { userWWWPlugin } from '@epinfresh/user'
import { Elysia } from 'elysia'

const port = Number(process.env.WWW_PORT) || 3000

const app = new Elysia()
  .get('/health', () => ({ status: 'ok', service: 'www' }))
  .use(userWWWPlugin)
  .use(productWWWPlugin)
  .listen(port)

console.log(`WWW API running at http://localhost:${port}`)

export type App = typeof app
export type WWWModels = InferModelsMap<App>
