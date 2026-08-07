import { type StaticDecode, Type } from '@sinclair/typebox'

import { parseEnv } from './env'

export const testEnvSchema = Type.Object({
  TEST_DATABASE_URL: Type.String({ format: 'uri' }),
  TEST_REDIS_URL: Type.String({ format: 'uri' }),
  TEST_SESSION_SECRET: Type.String({ minLength: 32 }),
})

export type TestEnv = StaticDecode<typeof testEnvSchema>

export function getTestEnv(): TestEnv {
  return parseEnv(testEnvSchema)
}
