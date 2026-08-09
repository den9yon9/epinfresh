import type { Logger } from '@epinfresh/shared'
import { getRequestContext } from '@epinfresh/shared'
import { Elysia } from 'elysia'

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

export const requestLogger = (logger: Logger) =>
  new Elysia({ name: 'request-logger' })
    .onRequest((ctx) => {
      const { requestId } = getRequestContext() ?? { requestId: undefined }
      ctx.set.headers['x-request-id'] = requestId ?? ''
      logger.info(
        { requestId, msg: 'request', method: ctx.request.method, path: getPath(ctx.request) },
        'request',
      )
    })
    .onAfterResponse({ as: 'global' }, (ctx) => {
      const rc = getRequestContext()
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
    })
    .onError({ as: 'global' }, (ctx) => {
      const rc = getRequestContext()
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
