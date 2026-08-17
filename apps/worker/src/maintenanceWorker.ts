import { pruneIdempotencyKeys } from '@epinfresh/checkout'
import {
  IDEMPOTENCY_KEY_RETENTION_DAYS,
  MAINTENANCE_JOB_NAMES,
  MAINTENANCE_QUEUE_NAME,
} from '@epinfresh/checkout/jobs'
import { closeDb, createDb } from '@epinfresh/database'
import { createDispatcher, createQueue, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

export interface MaintenanceWorker {
  worker: Worker
  close: () => Promise<void>
}

export function registerMaintenanceWorker(
  redisUrl: string,
  databaseUrl: string,
  logger: Logger,
): MaintenanceWorker {
  const db = createDb(databaseUrl, { logger })

  // repeatable job: 每天 03:00 UTC 触发一次幂等键清理。
  // upsertJobScheduler 幂等: 重复启动不会重复注册(以 id 覆盖)。
  // 注册失败只记日志: 调度器缺失的后果是当天少跑一次清理, 不应拖垮进程。
  const queue = createQueue(MAINTENANCE_QUEUE_NAME, { redisUrl })
  queue
    .upsertJobScheduler(
      MAINTENANCE_JOB_NAMES.PRUNE_IDEMPOTENCY_KEYS,
      { pattern: '0 3 * * *' },
      { name: MAINTENANCE_JOB_NAMES.PRUNE_IDEMPOTENCY_KEYS, data: {} },
    )
    .catch((err) => {
      logger.error({ err }, 'failed to register maintenance scheduler')
    })

  const processor = createDispatcher(
    {
      [MAINTENANCE_JOB_NAMES.PRUNE_IDEMPOTENCY_KEYS]: async (_data, logger) => {
        const olderThan = new Date(
          Date.now() - IDEMPOTENCY_KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        )
        const { pruned } = await pruneIdempotencyKeys(db, olderThan)
        logger.info({ olderThan, pruned }, 'pruned expired checkout idempotency keys')
      },
    },
    logger,
  )

  const worker = createWorker(MAINTENANCE_QUEUE_NAME, processor, { redisUrl, logger, metrics: {} })

  return {
    worker,
    close: async () => {
      await queue.close()
      await closeDb(db)
    },
  }
}
