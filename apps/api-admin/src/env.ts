import { baseEnvSchema, parseEnv, t } from '@epinfresh/shared'

export const adminEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  ADMIN_PORT: t.String({ pattern: '^\\d+$' }),
})

export const env = parseEnv(adminEnvSchema)
