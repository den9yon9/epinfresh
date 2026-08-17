import { createPaymentGatewaysFromEnv } from '@epinfresh/payment'
import type { Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

import { registerMaintenanceWorker } from './maintenanceWorker'
import { registerOutboxWorker } from './outboxWorker'
import { registerReconciliationWorker } from './reconciliationWorker'
import { registerEmailWorker } from './userWorker'

export interface WorkerRegistration {
  workers: Worker[]
  close: () => Promise<void>
}

export function registerWorkers(
  env: { REDIS_URL: string; DATABASE_URL: string },
  logger: Logger,
): WorkerRegistration {
  // 渠道注册表由共享支付 env 助手构建(与 storefront-api/admin-api 同一来源)
  const gateways = createPaymentGatewaysFromEnv(process.env)
  const email = registerEmailWorker(env.REDIS_URL, logger)
  const maintenance = registerMaintenanceWorker(env.REDIS_URL, env.DATABASE_URL, logger)
  const outbox = registerOutboxWorker(env.REDIS_URL, env.DATABASE_URL, logger)
  const reconciliation = registerReconciliationWorker(
    env.REDIS_URL,
    env.DATABASE_URL,
    gateways,
    logger,
  )
  return {
    workers: [email, maintenance.worker, outbox.worker, reconciliation.worker],
    close: async () => {
      await maintenance.close()
      await outbox.close()
      await reconciliation.close()
    },
  }
}
