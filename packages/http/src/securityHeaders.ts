import { Elysia } from 'elysia'

export const securityHeaders = (isProduction = false) =>
  new Elysia({ name: 'security-headers' }).onRequest(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if (isProduction) {
      set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
  })
