import { type Redis } from '@epinfresh/redis'
import type { Logger } from '@epinfresh/shared'
import { runWithRequestId } from '@epinfresh/shared'
import {
  type ConnectionOptions,
  type Processor,
  Queue,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from 'bullmq'

// bullmq v5 传 ioredis 实例即自动识别为共享连接(close() 不释放, 见 queue-base.js
// `shared: isRedisInstance(opts.connection)`); v4 时代的 useSharedConnection 选项已移除。
// 共享时调用方持有连接实例并负责关闭; worker 的阻塞连接不受影响(bullmq 内部始终 duplicate)。
// 传 redisUrl 时 bullmq 自建连接并自行管理生命周期。
// 指标(AUDIT #7): v5 默认开启 metric 采集(Redis 内 `metrics:completed/failed` 桶), opts.metrics
// 只控制 maxDataPoints 保留长度; 消费侧用 queue.getMetrics('completed') 读取(后续 /metrics 端点)。
export type QueueConnection =
  { connection: Redis; redisUrl?: never } | { connection?: never; redisUrl: string }

function resolveConnection(opts: QueueConnection): ConnectionOptions {
  if (opts.connection !== undefined) return opts.connection
  return { url: opts.redisUrl }
}

export function createQueue<T = unknown>(
  name: string,
  opts: QueueConnection & Partial<QueueOptions>,
) {
  const { connection, redisUrl, ...queueOpts } = opts
  return new Queue<T>(name, {
    connection: resolveConnection(opts),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    },
    ...queueOpts,
  })
}

export type JobHandler<T = unknown> = (data: T, logger: Logger) => Promise<void> | void

export function createDispatcher<T = unknown>(
  handlers: Record<string, JobHandler<T>>,
  logger: Logger,
): Processor<T> {
  return async (job) => {
    const handler = handlers[job.name]
    if (!handler) {
      throw new Error(`No handler registered for job name "${job.name}"`)
    }
    const requestId = (job.data as { requestId?: string } | null)?.requestId ?? `job-${job.id}`
    await runWithRequestId(requestId, () => handler(job.data, logger))
  }
}

export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts: QueueConnection & Partial<WorkerOptions> & { logger: Logger },
) {
  const { connection, redisUrl, logger, ...workerOpts } = opts
  const worker = new Worker<T>(name, processor, {
    connection: resolveConnection(opts),
    concurrency: 5,
    ...workerOpts,
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'BullMQ job failed')
  })

  worker.on('completed', (job) => {
    const duration = job.finishedOn ? job.finishedOn - job.timestamp : undefined
    logger.info({ jobId: job.id, jobName: job.name, duration }, 'BullMQ job completed')
  })

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'BullMQ job stalled')
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'BullMQ worker error')
  })

  return worker
}

export type { Job, Processor, Queue, Worker } from 'bullmq'
