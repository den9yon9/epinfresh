import type { ErrorContract } from '@epinfresh/shared'

export const USER_ERRORS = {
  LOGIN_FAILED: { status: 401, message: 'Invalid email or password' },
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
} as const satisfies ErrorContract<'LOGIN_FAILED' | 'USER_NOT_FOUND'>
