import { baseEnvSchema, t } from '@epinfresh/shared'

export const storefrontEnvSchema = t.Object({
  ...baseEnvSchema.properties,
  STOREFRONT_PORT: t.String({ pattern: '^\\d+$' }),
})
