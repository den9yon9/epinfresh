import { parseEnv } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

const workerEnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    { default: 'development' },
  ),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('debug'),
      Type.Literal('info'),
      Type.Literal('warn'),
      Type.Literal('error'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  REDIS_URL: Type.String({ format: 'uri' }),
})

export const env = parseEnv(workerEnvSchema)
