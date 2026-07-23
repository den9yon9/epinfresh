import { Elysia } from 'elysia'
import { logger } from './logger'

interface RequestContext {
  requestId: string
  start: number
}

const contexts = new WeakMap<Request, RequestContext>()

function getStatus(set: { status?: number | string }): number {
  const s = set.status
  if (s == null) return 200
  return typeof s === 'number' ? s : Number.parseInt(String(s), 10) || 200
}

function getPath(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return request.url
  }
}

export const requestLogger = () =>
  new Elysia({ name: 'request-logger' })
    .onRequest((ctx) => {
      const requestId = crypto.randomUUID()
      contexts.set(ctx.request, { requestId, start: Date.now() })
      ctx.set.headers['x-request-id'] = requestId
      logger.info(
        { requestId, msg: 'request', method: ctx.request.method, path: getPath(ctx.request) },
        'request',
      )
    })
    .onAfterResponse({ as: 'global' }, (ctx) => {
      const rc = contexts.get(ctx.request)
      const requestId = rc?.requestId ?? '-'
      const durationMs = rc ? Date.now() - rc.start : 0
      logger.info(
        {
          requestId,
          msg: 'response',
          method: ctx.request.method,
          path: getPath(ctx.request),
          status: getStatus(ctx.set),
          durationMs,
        },
        'response',
      )
      contexts.delete(ctx.request)
    })
    .onError({ as: 'global' }, (ctx) => {
      const rc = contexts.get(ctx.request)
      const requestId = rc?.requestId ?? '-'
      const durationMs = rc ? Date.now() - rc.start : 0
      const err = ctx.error as Error & { code?: string }
      logger.error(
        {
          requestId,
          msg: 'error',
          method: ctx.request.method,
          path: getPath(ctx.request),
          status: getStatus(ctx.set),
          durationMs,
          error: err.message,
          code: err.code,
          stack: err.stack,
        },
        'error',
      )
    })
