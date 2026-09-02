import type { Logger } from '@epinfresh/shared'

import { type OutboxEventRecord } from './service'

// event_type → 处理器类型。映射由 worker(app 层)组装并以必传参数注入 dispatchOutbox:
// outbox → 邮件等桥接需要编排多域, 按分层约束 domain 不可依赖 usecase/queue。
// 未注册的事件进死信。域内不提供默认注册表——空表默认值会让"忘传 handlers"静默变成全量死信。
export type OutboxEventHandler = (event: OutboxEventRecord, logger: Logger) => void | Promise<void>
