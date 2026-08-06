import { createLogger, hashPassword, parseEnv } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'

import { closeDb, createDb, schema } from './index'

const env = parseEnv(
  Type.Object({
    DATABASE_URL: Type.String({ format: 'uri' }),
    ADMIN_EMAIL: Type.String({ format: 'email', default: 'admin@example.com' }),
    ADMIN_PASSWORD: Type.String({ minLength: 1, default: 'admin123456' }),
    NODE_ENV: Type.Optional(
      Type.Union([Type.Literal('development'), Type.Literal('production'), Type.Literal('test')]),
    ),
    LOG_LEVEL: Type.Union(
      [
        Type.Literal('debug'),
        Type.Literal('info'),
        Type.Literal('warn'),
        Type.Literal('error'),
        Type.Literal('silent'),
      ],
      { default: 'info' },
    ),
  }),
)

const DEFAULT_ADMIN_PASSWORD = 'admin123456'

async function main(): Promise<void> {
  if (
    env.NODE_ENV === 'production' &&
    (env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12)
  ) {
    throw new Error('ADMIN_PASSWORD must be explicitly set (min 12 chars) in production')
  }

  const logger = createLogger(env.LOG_LEVEL)
  if (env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    logger.warn(
      { adminEmail: env.ADMIN_EMAIL },
      'using default ADMIN_PASSWORD; set a strong password for any non-local environment',
    )
  }

  const db = createDb(env.DATABASE_URL)
  try {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD)
    const [admin] = await db
      .insert(schema.users)
      .values({
        name: 'Administrator',
        email: env.ADMIN_EMAIL,
        passwordHash,
        role: 'admin',
      })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { role: 'admin', passwordHash, updatedAt: new Date() },
      })
      .returning()

    logger.info({ admin: { id: admin.id, email: admin.email } }, 'seed complete: admin user ready')
  } finally {
    await closeDb(db)
  }
}

main().catch((err) => {
  console.error(`[seed] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
