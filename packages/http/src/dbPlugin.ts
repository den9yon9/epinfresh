import { type Db, closeDb, createDb } from '@epinfresh/database'
import { Elysia } from 'elysia'

export function dbPlugin(connection: string | Db) {
  const client = typeof connection === 'string' ? createDb(connection) : connection
  return new Elysia({ name: 'infra-db' }).decorate('db', client).onStop(async () => {
    await closeDb(client)
  })
}
