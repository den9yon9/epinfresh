import { closeDb, createDb } from '@epinfresh/database'
import { type PaymentChannel, type PaymentGateway } from '@epinfresh/payment'
import {
  RECONCILE_INTERVAL_MS,
  RECONCILE_JOB_NAMES,
  RECONCILE_QUEUE_NAME,
  RECONCILE_STALE_AFTER_MS,
  reconcilePendingPayments,
} from '@epinfresh/payment-confirm'
import { createDispatcher, createQueue, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

export interface ReconciliationWorker {
  worker: Worker
  close: () => Promise<void>
}

// repeatable job: 每 RECONCILE_INTERVAL_MS 触发一次对账扫描。
// 渠道注册表来自共享支付 env 助手(mock 默认时无 queryPayment 网关, 任务空转)。
export function registerReconciliationWorker(
  redisUrl: string,
  databaseUrl: string,
  gateways: Partial<Record<PaymentChannel, PaymentGateway>>,
  logger: Logger,
): ReconciliationWorker {
  const db = createDb(databaseUrl)

  const queue = createQueue(RECONCILE_QUEUE_NAME, { redisUrl })
  queue
    .upsertJobScheduler(
      RECONCILE_JOB_NAMES.RUN,
      { every: RECONCILE_INTERVAL_MS },
      { name: RECONCILE_JOB_NAMES.RUN, data: {} },
    )
    .catch((err) => {
      logger.error({ err }, 'failed to register reconciliation scheduler')
    })

  const processor = createDispatcher(
    {
      [RECONCILE_JOB_NAMES.RUN]: async (_data, logger) => {
        const result = await reconcilePendingPayments(gateways, db, {
          staleAfterMs: RECONCILE_STALE_AFTER_MS,
        })
        logger.info(result, 'payment reconciliation run finished')
      },
    },
    logger,
  )

  const worker = createWorker(RECONCILE_QUEUE_NAME, processor, { redisUrl, logger })

  return {
    worker,
    close: async () => {
      await queue.close()
      await closeDb(db)
    },
  }
}
