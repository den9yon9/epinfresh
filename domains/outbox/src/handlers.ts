import type { Logger } from '@epinfresh/shared'

import { type OutboxEventRecord } from './service'

export type OutboxEventHandler = (event: OutboxEventRecord, logger: Logger) => void | Promise<void>

// event_type → 处理器注册表。具体映射由 worker(app 层)组装注入:
// outbox → 邮件等桥接需要编排多域, 按分层约束 domain 不可依赖 usecase/queue。
// 未注册的事件进死信。
export const outboxHandlers: Record<string, OutboxEventHandler> = {}
