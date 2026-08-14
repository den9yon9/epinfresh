import { Redis } from 'ioredis'

export type { Redis }

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // 共享连接配置: BullMQ 要求 maxRetriesPerRequest: null(阻塞命令),
    // 官方建议 enableOfflineQueue: false(断线期间不缓冲命令, 避免重连后重复处理 job)。
    // 副作用: session 在 redis 故障时立即失败(原为 3 次重试后失败), 均走 null session → 401。
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 1_000),
  })
}
