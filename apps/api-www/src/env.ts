import { baseEnvSchema, t } from '@epinfresh/shared'

export const wwwEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  WWW_PORT: t.String({ pattern: '^\\d+$' }),
})
