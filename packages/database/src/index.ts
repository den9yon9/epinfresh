import { fileURLToPath } from 'node:url'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

export { schema }
export { table } from './model'

type PgDatabase = PostgresJsDatabase<typeof schema>

export type Db = PgDatabase

export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type DbClient = Db | DbTransaction

// ponytail: initDb() runs before Elysia listens; never undefined at request time
export let db!: Db

export function setDb(d: Db): void {
  db = d
}

let queryClient: Sql | null = null

export function createDb(connectionString: string): Db {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    prepare: false,
  })
  return drizzle(client, { schema })
}

export function initDb(connectionString: string): Db {
  if (queryClient) {
    queryClient.end({ timeout: 5 }).catch(() => {})
  }
  queryClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    prepare: false,
  })
  db = drizzle(queryClient, { schema })
  return db
}

export function getSql(): Sql {
  if (!queryClient) throw new Error('initDb() not called')
  return queryClient
}

export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end({ timeout: 5 })
    queryClient = null
  }
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

export async function runMigrations(): Promise<void> {
  if (!db) throw new Error('initDb() must be called before runMigrations()')
  await migrate(db, { migrationsFolder })
}
