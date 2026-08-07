import { getTestEnv } from '@epinfresh/shared/testing'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'

import { createDb, type Db, runMigrations } from './index'

async function ensureTestDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString)
  const dbName = url.pathname.slice(1)
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const sql = postgres(adminUrl.toString(), { max: 1 })
  try {
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists
    `
    if (!row.exists) {
      await sql`CREATE DATABASE ${sql(dbName)}`
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

export async function prepareTestDb(): Promise<Db> {
  const url = getTestEnv().TEST_DATABASE_URL
  await ensureTestDatabase(url)
  await runMigrations(url)
  return createDb(url)
}

export async function resetDb(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  )
  if (rows.length > 0) {
    const names = rows.map((r) => `"${r.tablename}"`).join(', ')
    await db.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`))
  }
}
