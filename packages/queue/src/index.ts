import type { Logger } from '@epinfresh/shared'
import {
  type ConnectionOptions,
  type Processor,
  Queue,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from 'bullmq'

type QueueConnectionOpts = { redisUrl: string }

function resolveRedisConnection(opts: QueueConnectionOpts): ConnectionOptions {
  return { url: opts.redisUrl } as unknown as ConnectionOptions
}

export function createQueue<T = unknown>(
  name: string,
  opts: Partial<QueueOptions> & QueueConnectionOpts,
) {
  const { redisUrl, ...queueOpts } = opts
  const connection = resolveRedisConnection({ redisUrl })
  return new Queue<T>(name, {
    connection,
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
    await handler(job.data, logger)
  }
}

export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts: Partial<WorkerOptions> & QueueConnectionOpts & { logger: Logger },
) {
  const { redisUrl, logger, ...workerOpts } = opts
  const connection = resolveRedisConnection({ redisUrl })
  const worker = new Worker<T>(name, processor, {
    connection,
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
