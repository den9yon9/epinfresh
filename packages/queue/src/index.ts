import type { RedisOptions } from '@epinfresh/redis'
import type { Logger } from '@epinfresh/shared'
import {
  type ConnectionOptions,
  type Processor,
  Queue,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from 'bullmq'

interface QueueConnectionOpts {
  redisUrl?: string
  redisOptions?: RedisOptions
}

function resolveRedisConnection(opts?: QueueConnectionOpts): ConnectionOptions {
  if (opts?.redisOptions) return opts.redisOptions
  if (opts?.redisUrl) return { url: opts.redisUrl } as unknown as ConnectionOptions
  throw new Error('Queue requires Redis. Pass { redisUrl } to createQueue/createWorker.')
}

export function createQueue<T = unknown>(
  name: string,
  opts?: Partial<QueueOptions> & QueueConnectionOpts,
) {
  const { redisUrl, redisOptions, ...queueOpts } = opts ?? {}
  const connection = resolveRedisConnection({ redisUrl, redisOptions })
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

export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts: Partial<WorkerOptions> & QueueConnectionOpts & { logger: Logger },
) {
  const { redisUrl, redisOptions, logger, ...workerOpts } = opts ?? {}
  const connection = resolveRedisConnection({ redisUrl, redisOptions })
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: 5,
    ...workerOpts,
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'BullMQ job failed')
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'BullMQ worker error')
  })

  return worker
}

export type { Job } from 'bullmq'
export * from './jobs/email'
