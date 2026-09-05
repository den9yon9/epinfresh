import { createHash, randomBytes } from 'node:crypto'

import { type DbClient, schema } from '@epinfresh/database'
import { err, hashPassword, ok, type Result, verifyPassword } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { count, eq } from 'drizzle-orm'

import type {
  LoginInputSchema,
  RegisterInputSchema,
  UpdateProfileInputSchema,
  UpdateUserInputSchema,
  UserListQuerySchema,
} from './model'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

// 令牌 32 字节随机高熵, sha256 不可逆 + 唯一索引精确查找, 无需 argon 反查
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type ResetTokenError = 'RESET_TOKEN_INVALID' | 'RESET_TOKEN_EXPIRED'

export async function requestPasswordReset(
  email: string,
  client: DbClient,
): Promise<Result<{ token: string }, never>> {
  const token = randomBytes(32).toString('hex')
  const [user] = await client.select().from(schema.users).where(eq(schema.users.email, email))
  if (user) {
    await client.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    })
  }
  // 不存在也返回 ok, 不泄露邮箱注册状态
  return ok({ token })
}

export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
  client: DbClient,
): Promise<Result<{ userId: string }, ResetTokenError>> {
  const [row] = await client
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, hashResetToken(token)))
  if (!row || row.usedAt) return err('RESET_TOKEN_INVALID')
  if (row.expiresAt.getTime() < Date.now()) return err('RESET_TOKEN_EXPIRED')

  const passwordHash = await hashPassword(newPassword)
  await client.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, row.userId))
  await client
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.id, row.id))
  return ok({ userId: row.userId })
}

let dummyHash: string | null = null

async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await hashPassword('epinfresh-dummy')
  }
  return dummyHash
}

export async function registerUser(input: Static<typeof RegisterInputSchema>, client: DbClient) {
  const passwordHash = await hashPassword(input.password)
  const [user] = await client
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash,
      phone: input.phone ?? null,
    })
    .returning()
  return user
}

export async function loginUser(input: Static<typeof LoginInputSchema>, client: DbClient) {
  const email = input.email
  const [user] = await client.select().from(schema.users).where(eq(schema.users.email, email))
  if (!user) {
    await verifyPassword(input.password, await getDummyHash())
    return err('LOGIN_FAILED')
  }
  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) return err('LOGIN_FAILED')
  if (!user.isActive) return err('ACCOUNT_DISABLED')
  return ok(user)
}

export async function updateUser(
  id: string,
  input: Static<typeof UpdateUserInputSchema>,
  client: DbClient,
): Promise<Result<typeof schema.users.$inferSelect, 'USER_NOT_FOUND'>> {
  return updateUserById(id, input, client)
}

export async function updateProfile(
  id: string,
  input: Static<typeof UpdateProfileInputSchema>,
  client: DbClient,
): Promise<Result<typeof schema.users.$inferSelect, 'USER_NOT_FOUND'>> {
  return updateUserById(id, input, client)
}

async function updateUserById(
  id: string,
  input: Static<typeof UpdateUserInputSchema> | Static<typeof UpdateProfileInputSchema>,
  client: DbClient,
): Promise<Result<typeof schema.users.$inferSelect, 'USER_NOT_FOUND'>> {
  const [updated] = await client
    .update(schema.users)
    .set(input)
    .where(eq(schema.users.id, id))
    .returning()
  if (!updated) return err('USER_NOT_FOUND')
  return ok(updated)
}

export async function getUserById(id: string, client: DbClient) {
  const [user] = await client.select().from(schema.users).where(eq(schema.users.id, id))
  if (!user) return err('USER_NOT_FOUND')
  return ok(user)
}

export async function listUsers(opts: Static<typeof UserListQuerySchema>, client: DbClient) {
  const { page, pageSize } = opts
  const offset = (page - 1) * pageSize
  const rows = await client
    .select()
    .from(schema.users)
    .orderBy(schema.users.createdAt)
    .limit(pageSize)
    .offset(offset)
  const [{ total }] = await client.select({ total: count() }).from(schema.users)
  return { items: rows, total: Number(total), page, pageSize }
}

// 注册消费者总数(看板 KPI; 不含 admin 角色)
export async function countCustomerUsers(client: DbClient): Promise<number> {
  const [row] = await client
    .select({ total: count() })
    .from(schema.users)
    .where(eq(schema.users.role, 'customer'))
  return Number(row.total)
}
