import { Elysia } from 'elysia'

const port = Number(process.env.ADMIN_PORT) || 3001

const app = new Elysia().get('/health', () => ({ status: 'ok', service: 'admin' })).listen(port)

console.log(`⚙️  Admin API running at http://localhost:${port}`)

export type App = typeof app
