import pino, { type Level, type Logger } from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const ALLOWED = new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'silent'])

function readInitialLevel(): string {
  const raw = process.env.LOG_LEVEL
  return raw && ALLOWED.has(raw as LogLevel) ? raw : 'info'
}

export const logger: Logger = pino({
  level: readInitialLevel() as Level,
  base: { service: 'epinfresh' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
})
