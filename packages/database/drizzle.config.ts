import { getEnv } from '@epinfresh/shared'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: getEnv().DATABASE_URL,
  },
})
