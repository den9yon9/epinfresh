import { createPaymentGatewaysFromEnv } from '@epinfresh/payment'
import type { Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

import type { WorkerEnv } from './env'
import { registerLogisticsWorker } from './logisticsWorker'
import { createMailer } from './mailer'
import { registerMaintenanceWorker } from './maintenanceWorker'
import { registerOutboxWorker } from './outboxWorker'
import { registerReconciliationWorker } from './reconciliationWorker'
import { registerEmailWorker } from './userWorker'

export interface WorkerRegistration {
  workers: Worker[]
  close: () => Promise<void>
}

export function registerWorkers(env: WorkerEnv, logger: Logger): WorkerRegistration {
  // 渠道注册表由共享支付 env 助手构建(与 storefront-api/admin-api 同一来源)
  const gateways = createPaymentGatewaysFromEnv(process.env)
  // 邮件发送能力: console/smtp 由 MAIL_TRANSPORT 决定, 注入 email worker
  const mailer = createMailer(env, logger)
  const email = registerEmailWorker(env, mailer, logger)
  const maintenance = registerMaintenanceWorker(env.REDIS_URL, env.DATABASE_URL, logger)
  const outbox = registerOutboxWorker(env.REDIS_URL, env.DATABASE_URL, logger)
  const reconciliation = registerReconciliationWorker(
    env.REDIS_URL,
    env.DATABASE_URL,
    gateways,
    logger,
  )
  const logistics = registerLogisticsWorker(
    env.REDIS_URL,
    env.DATABASE_URL,
    Number(env.LOGISTICS_POLL_INTERVAL_MS),
    logger,
  )
  return {
    workers: [email, maintenance.worker, outbox.worker, reconciliation.worker, logistics.worker],
    close: async () => {
      await maintenance.close()
      await outbox.close()
      await reconciliation.close()
      await logistics.close()
    },
  }
}
