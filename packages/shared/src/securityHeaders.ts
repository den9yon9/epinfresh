import { Elysia } from 'elysia'
import { getEnv } from './env'

export const securityHeaders = () =>
  new Elysia({ name: 'security-headers' }).onRequest(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if (getEnv().NODE_ENV === 'production') {
      set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
  })
