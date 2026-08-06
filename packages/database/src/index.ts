import { fileURLToPath } from 'node:url'

import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'

import * as schema from './schema'

export { schema }
export { emailSchema, table } from './model'
export { ORDER_STATUS, type OrderStatus } from './schema/orders'
export { PRODUCT_STATUS, type ProductStatus } from './schema/products'
export { USER_ROLE, type UserRole } from './schema/users'

type PgDatabase = PostgresJsDatabase<typeof schema> & { $client: Sql }

export type Db = PgDatabase

export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type DbClient = Db | DbTransaction

export function createDb(connectionString: string): Db {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    prepare: false,
  })
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
