import { AsyncLocalStorage } from 'node:async_hooks'

interface RequestContext {
  requestId: string
  start: number
}

const ctx = new AsyncLocalStorage<RequestContext>()

export function runWithRequestId<T>(requestId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return ctx.run({ requestId, start: Date.now() }, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return ctx.getStore()
}

export function getRequestId(): string | undefined {
  return ctx.getStore()?.requestId
}
