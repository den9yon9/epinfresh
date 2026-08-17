import { createConfig } from './config'
import { startPayMockServer } from './server'

const config = createConfig()
const server = startPayMockServer(config)
console.log(`[pay-mock-server] listening on ${server.url}`)
console.log(`[pay-mock-server] simulate payment: POST ${server.url}/__simulate__/pay`)
console.log(`[pay-mock-server] notify target: ${config.notifyUrl}`)
