const HASH_ALGO = 'argon2id' as const

export async function hashPassword(password: string): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return Bun.password.hash(password, HASH_ALGO)
  }
  throw new Error('[crypto] Node.js runtime requires argon2 package fallback implementation.')
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof Bun !== 'undefined') {
    return Bun.password.verify(password, hash, HASH_ALGO)
  }
  throw new Error('[crypto] Node.js runtime requires argon2 package fallback implementation.')
}
