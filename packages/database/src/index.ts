import { fileURLToPath } from 'node:url'

import { type Logger } from '@epinfresh/shared'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'

import * as schema from './schema'

export { schema }
export { emailSchema, table } from './model'
export { ORDER_STATUS, type OrderStatus } from './schema/order/orders'
export { OUTBOX_EVENT_STATUS, type OutboxEventStatus } from './schema/outbox/outbox-events'
export { PAYMENT_STATUS, type PaymentStatus } from './schema/payment/payments'
export { REFUND_STATUS, type RefundStatus, refundStatus } from './schema/payment/refunds'
export { PRODUCT_STATUS, type ProductStatus } from './schema/product/products'
export { USER_ROLE, type UserRole } from './schema/user/users'
export { withTransaction } from './transaction'

type PgDatabase = PostgresJsDatabase<typeof schema> & { $client: Sql }

export type Db = PgDatabase

export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type DbClient = Db | DbTransaction

// 慢查询阈值: 超过即记日志(定位 API/worker 长耗时)
const SLOW_QUERY_THRESHOLD_MS = 100

export interface DbOptions {
  // 提供后启用慢查询日志: 每次查询耗时超过 slowQueryThresholdMs 记录 SQL 与耗时
  logger?: Logger
  slowQueryThresholdMs?: number
}

export function createDb(connectionString: string, options: DbOptions = {}): Db {
  const { logger, slowQueryThresholdMs = SLOW_QUERY_THRESHOLD_MS } = options
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    prepare: false,
  })
  // DB 耗时 hook: 包装 postgres.js 的 unsafe(drizzle postgres-js 驱动经它执行所有查询)。
  // 只记慢查询, 不记录全量 SQL(避免日志噪音)。
  if (logger) {
    const originalUnsafe = client.unsafe.bind(client)
    client.unsafe = ((query: string, parameters?: unknown[], queryOptions?: object) => {
      const start = performance.now()
      const result = originalUnsafe(query, parameters as never, queryOptions as never)
      const report = () => {
        const durationMs = Math.round(performance.now() - start)
        if (durationMs > slowQueryThresholdMs) {
          logger.warn({ durationMs, sql: query.slice(0, 300) }, 'slow query')
        }
      }
      result.then(report, report)
      return result
    }) as unknown as typeof client.unsafe
  }
  return drizzle(client, { schema })
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end({ timeout: 5 }).catch(() => {})
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

export async function runMigrations(connectionString: string): Promise<void> {
  const db = createDb(connectionString)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await closeDb(db)
  }
}
