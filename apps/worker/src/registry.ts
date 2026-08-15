import type { Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

import { registerMaintenanceWorker } from './maintenanceWorker'
import { registerEmailWorker } from './userWorker'

export interface WorkerRegistration {
  workers: Worker[]
  close: () => Promise<void>
}

export function registerWorkers(
  env: { REDIS_URL: string; DATABASE_URL: string },
  logger: Logger,
): WorkerRegistration {
  const email = registerEmailWorker(env.REDIS_URL, logger)
  const maintenance = registerMaintenanceWorker(env.REDIS_URL, env.DATABASE_URL, logger)
  return {
    workers: [email, maintenance.worker],
    close: async () => {
      await maintenance.close()
    },
  }
}
