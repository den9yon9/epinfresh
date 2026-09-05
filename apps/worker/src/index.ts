import { createMetrics, Gauge, type Registry, renderMetrics } from '@epinfresh/http'
import { createLogger } from '@epinfresh/shared'

import { createEnv } from './env'
import { registerWorkers } from './registry'

const env = createEnv()
const logger = createLogger(env.LOG_LEVEL)

logger.info('Worker application starting...')

const registration = registerWorkers(env, logger)
const { workers, close, queues } = registration

// 可选健康端点: 容器健康检查与 e2e 就绪探测(未设 HEALTH_PORT 则不起);
// 同端口附带 /metrics(Prometheus 文本), BullMQ 队列 job counts 每次抓取时刷新。
if (env.HEALTH_PORT) {
  const port = Number(env.HEALTH_PORT)
  const metrics: Registry = createMetrics()
  const jobCounts = new Gauge({
    name: 'bullmq_queue_jobs',
    help: 'BullMQ jobs by queue and state',
    labelNames: ['queue', 'state'],
    registers: [metrics],
  })

  Bun.serve({
    port,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/metrics') {
        for (const { name, queue } of queues) {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          )
          for (const [state, n] of Object.entries(counts)) {
            jobCounts.set({ queue: name, state }, n ?? 0)
          }
        }
        return new Response(await renderMetrics(metrics), {
          headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
        })
      }
      return new Response('ok')
    },
  })
  logger.info({ port }, 'worker health/metrics endpoint listening')
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down worker...')
  const results = await Promise.allSettled(workers.map((worker) => worker.close()))
  await close()
  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    logger.error({ count: failed.length }, 'Errors during worker shutdown')
    process.exit(1)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
