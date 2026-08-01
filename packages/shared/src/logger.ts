import pino, { type Level, type Logger } from 'pino'

export type { Logger } from 'pino'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const ALLOWED = new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'silent'])

export function createLogger(level: LogLevel): Logger {
  return pino({
    level: ALLOWED.has(level) ? (level as Level) : 'info',
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
}
