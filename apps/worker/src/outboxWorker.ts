import { closeDb, createDb, type Db, withTransaction } from '@epinfresh/database'
import { sendPaymentSucceededEmail } from '@epinfresh/notifications'
import {
  claimOutboxBatch,
  completeOutboxEvent,
  failOutboxEvent,
  OUTBOX_BATCH_SIZE,
  type OutboxEventHandler,
  outboxHandlers,
} from '@epinfresh/outbox'
import {
  OUTBOX_JOB_NAMES,
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_QUEUE_NAME,
} from '@epinfresh/outbox/jobs'
import { createDispatcher, createQueue, createWorker, type Worker } from '@epinfresh/queue'
import type { Logger } from '@epinfresh/shared'
import { EMAIL_QUEUE_NAME, type SendEmailJobData } from '@epinfresh/user/jobs'

export interface OutboxWorker {
  worker: Worker
  close: () => Promise<void>
}

export function registerOutboxWorker(
  redisUrl: string,
  databaseUrl: string,
  logger: Logger,
): OutboxWorker {
  const db = createDb(databaseUrl, { logger })

  // 邮件队列生产者: outbox 事件桥接到 email worker 的投递出口
  const emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME, { redisUrl })

  // repeatable job: 每 OUTBOX_POLL_INTERVAL_MS 触发一次 dispatch 扫描。
  // upsertJobScheduler 幂等: 重复启动不会重复注册(以 id 覆盖)。
  const queue = createQueue(OUTBOX_QUEUE_NAME, { redisUrl })
  queue
    .upsertJobScheduler(
      OUTBOX_JOB_NAMES.DISPATCH,
      { every: OUTBOX_POLL_INTERVAL_MS },
      { name: OUTBOX_JOB_NAMES.DISPATCH, data: {} },
    )
    .catch((err) => {
      logger.error({ err }, 'failed to register outbox dispatch scheduler')
    })

  // 事件映射在 app 层组装(见 domains/outbox/src/handlers.ts 的分层说明);
  // handler 抛错(含收件人缺失等数据异常)由 dispatchOutbox 捕获 → 退避重试/死信。
  const handlers: Record<string, OutboxEventHandler> = {
    'payment.succeeded': (event) => sendPaymentSucceededEmail(event, { client: db, emailQueue }),
  }

  const processor = createDispatcher(
    {
      [OUTBOX_JOB_NAMES.DISPATCH]: async (_data, logger) => {
        await dispatchOutbox(db, logger, handlers)
      },
    },
    logger,
  )

  const worker = createWorker(OUTBOX_QUEUE_NAME, processor, { redisUrl, logger, metrics: {} })

  return {
    worker,
    close: async () => {
      await queue.close()
      await emailQueue.close()
      await closeDb(db)
    },
  }
}

// 单次扫描: 原子抢占一批 → 按 event_type 分发 → 成功标记 / 失败退避或死信。
// handlers 可注入以便测试; 默认用域注册表。
export async function dispatchOutbox(
  db: Db,
  logger: Logger,
  handlers: Record<string, OutboxEventHandler> = outboxHandlers,
): Promise<void> {
  const claimed = await withTransaction(db, (tx) => claimOutboxBatch(tx, OUTBOX_BATCH_SIZE))
  for (const event of claimed) {
    const handler = handlers[event.eventType]
    if (!handler) {
      await failOutboxEvent(db, event.id, event.attempts)
      logger.warn(
        { eventId: event.id, eventType: event.eventType, attempts: event.attempts },
        'no outbox handler registered; dead-lettering event',
      )
      continue
    }
    try {
      await handler(event, logger)
      await completeOutboxEvent(db, event.id)
    } catch (caught) {
      await failOutboxEvent(db, event.id, event.attempts)
      logger.error(
        {
          eventId: event.id,
          eventType: event.eventType,
          attempts: event.attempts,
          err: caught instanceof Error ? caught.message : String(caught),
        },
        'outbox event dispatch failed',
      )
    }
  }
}
