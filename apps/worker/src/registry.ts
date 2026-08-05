import type { Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { registerEmailWorker } from './userWorker'

export function registerWorkers(redisUrl: string, logger: Logger): Worker[] {
  return [registerEmailWorker(redisUrl, logger)]
}
