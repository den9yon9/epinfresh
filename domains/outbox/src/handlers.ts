import type { Logger } from '@epinfresh/shared'

import { type OutboxEventRecord } from './service'

export type OutboxEventHandler = (event: OutboxEventRecord, logger: Logger) => void | Promise<void>

// event_type → 处理器注册表。worker 按 event_type 分发, 未注册的事件进死信。
export const outboxHandlers: Record<string, OutboxEventHandler> = {
  'payment.succeeded': (event, logger) => {
    // ponytail: 占位通知, 只打日志; 接真实邮件/短信时在此投递。
    // 事件 payload 已含 orderId/paymentId/amount/currency/provider/paidAt, 可直接组装。
    logger.info({ eventId: event.id, payload: event.payload }, 'payment succeeded event dispatched')
  },
}
