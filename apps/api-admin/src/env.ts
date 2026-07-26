import { baseEnvSchema, t } from '@epinfresh/shared'

export const adminEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  ADMIN_PORT: t.String({ pattern: '^\\d+$' }),
})
