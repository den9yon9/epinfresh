import { type RedisOptions, createRedis, getRedis } from '@epinfresh/redis'
import { logger } from '@epinfresh/shared'
import { type Processor, Queue, type QueueOptions, Worker, type WorkerOptions } from 'bullmq'

interface QueueConnectionOpts {
  redisUrl?: string
  redisOptions?: RedisOptions
}

function resolveRedisConnection(opts?: QueueConnectionOpts) {
  if (opts?.redisUrl) return createRedis(opts.redisUrl, opts.redisOptions)
  try {
    return getRedis()
  } catch (cause) {
    throw new Error(
      'Queue requires Redis. Pass { redisUrl } to createQueue/createWorker, or call initRedis() first.',
      { cause },
    )
  }
}

export function createQueue<T = unknown>(
  name: string,
  opts?: Partial<QueueOptions> & QueueConnectionOpts,
): Queue<T> {
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
  opts?: Partial<WorkerOptions> & QueueConnectionOpts,
): Worker<T> {
  const { redisUrl, redisOptions, ...workerOpts } = opts ?? {}
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
