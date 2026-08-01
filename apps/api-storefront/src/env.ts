import { baseEnvSchema, parseEnv, t } from '@epinfresh/shared'

export const storefrontEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  STOREFRONT_PORT: t.String({ pattern: '^\\d+$' }),
})

export const env = parseEnv(storefrontEnvSchema)
