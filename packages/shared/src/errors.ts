import { type ElysiaCustomStatusResponse, status } from 'elysia'

export type ErrorContract<E extends string> = { [K in E]: { status: number; message: string } }

export function toError<E extends string, C extends ErrorContract<E>>(
  contract: C,
  code: E,
): ElysiaCustomStatusResponse<C[E]['status'], { error: E; message: string }> {
  const entry = contract[code]
  return status(entry.status, {
    error: code,
    message: entry.message,
  }) as unknown as ElysiaCustomStatusResponse<C[E]['status'], { error: E; message: string }>
}
