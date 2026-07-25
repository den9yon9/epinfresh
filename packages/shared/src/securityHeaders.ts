import { Elysia } from 'elysia'

export const securityHeaders = () =>
  new Elysia({ name: 'security-headers' }).onRequest(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  })
