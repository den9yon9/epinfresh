import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { orders } from './../order/orders'

// 轨迹状态(由 provider 快照归一化; pending = 已建单但承运商尚无轨迹)。
// rejected = 拒收(终局), delivery_failed = 派送失败(可重派): 两者是"异常收尾"——
// 都不能参与签收自动完成, 拒收单更不能被超时自动完成(语义: 用户钱货两空)。
export const LOGISTICS_TRACK_STATUS = [
  'pending',
  'collected',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'rejected',
] as const
export type LogisticsTrackStatus = (typeof LOGISTICS_TRACK_STATUS)[number]

export const logisticsTrackStatus = pgEnum('logistics_track_status', LOGISTICS_TRACK_STATUS)

// 轨迹事件(jsonb 数组元素): { time: ISO 字符串, status: 归一化状态(不含 pending——
// pending 是"尚无轨迹"的行级状态, 不作为事件), desc: 承运商原文 }
export interface LogisticsTrackEventData {
  time: string
  status: Exclude<LogisticsTrackStatus, 'pending'>
  desc: string
}

// 单包裹模型: 一单一条轨迹(orderId 唯一)。多包裹/拆单时演进为 shipments 表(tech-debt)。
export const logisticsTracks = pgTable(
  'logistics_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    company: varchar('company', { length: 32 }).notNull(),
    trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
    status: logisticsTrackStatus('status').default('pending').notNull(),
    events: jsonb('events')
      .notNull()
      .default(sql`'[]'::jsonb`),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    orderIdIdx: unique('logistics_tracks_order_id_unique').on(t.orderId),
    pollIdx: index('logistics_tracks_poll_idx').on(t.status, t.updatedAt),
  }),
)
