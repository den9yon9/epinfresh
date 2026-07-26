import { getRedis } from '@epinfresh/session'
import { logger } from '@epinfresh/shared'
import { type Processor, Queue, type QueueOptions, Worker, type WorkerOptions } from 'bullmq'

export function createQueue<T = unknown>(name: string, opts?: Partial<QueueOptions>): Queue<T> {
  const connection = getRedis()
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
    ...opts,
  })
}

export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts?: Partial<WorkerOptions>,
): Worker<T> {
  const connection = getRedis()
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: 5,
    ...opts,
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
