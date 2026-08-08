import { closeDb, type Db } from '@epinfresh/database'
import { Elysia } from 'elysia'

export function dbPlugin(client: Db) {
  return new Elysia({ name: 'infra-db' }).decorate('db', client).onStop(async () => {
    await closeDb(client)
  })
}
