import { env } from '@epinfresh/shared'
import { Redis } from 'ioredis'

export const redis = new Redis(env.REDIS_URL)
