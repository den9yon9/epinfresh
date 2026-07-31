import { fileURLToPath } from 'node:url'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Elysia } from 'elysia'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

export { schema }
export { table } from './model'

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

export function dbPlugin(connection: string | Db) {
  const client = typeof connection === 'string' ? createDb(connection) : connection
  return new Elysia({ name: 'infra-db' }).decorate('db', client).onStop(async () => {
    await closeDb(client)
  })
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
