import { closeDb, createDb } from '@epinfresh/database'
import { createLogisticsProviderFromEnv, LOGISTICS_JOB_NAMES } from '@epinfresh/logistics'
import { LOGISTICS_POLL_INTERVAL_MS, LOGISTICS_QUEUE_NAME } from '@epinfresh/logistics/jobs'
import { pollAndSyncShippedOrders } from '@epinfresh/logistics-sync'
import { createDispatcher, createQueue, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'

export interface LogisticsWorker {
  worker: Worker
  close: () => Promise<void>
}

// 轨迹轮询 worker: 周期拉承运商快照落库, 签收驱动订单完成。
// provider 由 env 选择(mock/kuaidi100), 域内同一来源(build 时从 process.env 读)。
export function registerLogisticsWorker(
  redisUrl: string,
  databaseUrl: string,
  pollIntervalMs: number,
  logger: Logger,
): LogisticsWorker {
  const db = createDb(databaseUrl, { logger })
  const provider = createLogisticsProviderFromEnv(process.env)

  // repeatable job: 每 pollIntervalMs 触发一次轮询。
  // upsertJobScheduler 幂等: 重复启动不会重复注册(以 id 覆盖)。
  const queue = createQueue(LOGISTICS_QUEUE_NAME, { redisUrl })
  queue
    .upsertJobScheduler(
      LOGISTICS_JOB_NAMES.POLL,
      // env 覆盖默认间隔(默认 10 分钟; e2e 置 2s)
      { every: pollIntervalMs > 0 ? pollIntervalMs : LOGISTICS_POLL_INTERVAL_MS },
      { name: LOGISTICS_JOB_NAMES.POLL, data: {} },
    )
    .catch((err) => {
      logger.error({ err }, 'failed to register logistics poll scheduler')
    })

  const processor = createDispatcher(
    {
      [LOGISTICS_JOB_NAMES.POLL]: async (_data, logger) => {
        const summary = await pollAndSyncShippedOrders(db, provider)
        if (summary.polled > 0 || summary.failed > 0) {
          logger.info(summary, 'logistics poll run finished')
        }
        // 拒收/派送失败: 不自动完成, 告警人工跟进(后续可接退款编排)
        if (summary.exceptions > 0) {
          logger.warn(summary, 'logistics exceptions detected; manual refund needed')
        }
        // 超时未签收预警
        if (summary.staleNotDelivered > 0) {
          logger.warn(
            { staleNotDelivered: summary.staleNotDelivered },
            'stale not-delivered shipments detected',
          )
        }
      },
    },
    logger,
  )

  const worker = createWorker(LOGISTICS_QUEUE_NAME, processor, { redisUrl, logger, metrics: {} })

  return {
    worker,
    close: async () => {
      await queue.close()
      await closeDb(db)
    },
  }
}
