import type { AnyElysia, Static } from 'elysia'

export type InferModel<TApp extends AnyElysia, K extends keyof TApp['models']> = Static<
  ReturnType<TApp['models'][K]['Schema']>
>

export type InferModelsMap<TApp extends AnyElysia> = {
  [K in keyof TApp['models']]: InferModel<TApp, K>
}
