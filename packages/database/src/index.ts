import { fileURLToPath } from 'node:url'
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

export { schema }
export { table } from './model'

type PgDatabase = PostgresJsDatabase<typeof schema>

export type Db = PgDatabase & {
  $primary: Sql
}

let queryClient: Sql | null = null
let dbInstance: Db | null = null
let cachedDbUrl: string | null = null

export interface DbOptions {
  max?: number
  idleTimeout?: number
  connectTimeout?: number
  prepare?: boolean
}

function makeDb(client: Sql): Db {
  const instance = drizzle(client, { schema })
  return Object.assign(instance, { $primary: client }) as unknown as Db
}

export function createDb(connectionString: string, opts: DbOptions = {}): Db {
  const client = postgres(connectionString, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: opts.connectTimeout ?? 30,
    prepare: opts.prepare ?? false,
  })
  return makeDb(client)
}

export function initDb(
  connectionString: string,
  opts: DbOptions = {},
): { db: Db; queryClient: Sql } {
  if (dbInstance && queryClient) {
    if (cachedDbUrl !== connectionString) {
      throw new Error(`initDb called with different URL; already initialized with ${cachedDbUrl}`)
    }
    return { db: dbInstance, queryClient }
  }
  cachedDbUrl = connectionString
  queryClient = postgres(connectionString, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: opts.connectTimeout ?? 30,
    prepare: opts.prepare ?? false,
  })
  dbInstance = makeDb(queryClient)
  return { db: dbInstance, queryClient }
}

export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end({ timeout: 5 })
    queryClient = null
    dbInstance = null
  }
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

export async function runMigrations(target?: Db): Promise<void> {
  const instance = target ?? dbInstance ?? (db as unknown as Db)
  await migrate(instance, { migrationsFolder })
}

export const db = new Proxy({} as Db, {
  get(_t, prop) {
    if (!dbInstance) {
      throw new Error(
        'Database accessed before initDb(). Call initDb(env.DATABASE_URL) at app bootstrap.',
      )
    }
    return Reflect.get(dbInstance, prop as string | symbol, dbInstance)
  },
})

export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
export type TypedDb = Db
