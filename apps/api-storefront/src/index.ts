import { Elysia } from 'elysia'

const port = Number(process.env.STOREFRONT_PORT) || 3000

const app = new Elysia()
  .get('/health', () => ({ status: 'ok', service: 'storefront' }))
  .listen(port)

console.log(`🛍️  Storefront API running at http://localhost:${port}`)

export type App = typeof app
