const HASH_ALGO = 'argon2id' as const

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, HASH_ALGO)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash, HASH_ALGO)
}
