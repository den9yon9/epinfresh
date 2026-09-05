import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, desc, eq } from 'drizzle-orm'

export type AddressError = 'ADDRESS_NOT_FOUND'

// 部分唯一索引(每个用户至多一个默认地址)在并发写默认地址时可能 23505 冲突:
// 重试一次即可(对方事务已提交, 重试会先清旧默认再设新默认), 避免 500。
function isUniqueViolation(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code: string }).code === '23505'
  )
}

async function withDefaultRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (caught) {
    if (isUniqueViolation(caught)) return fn()
    throw caught
  }
}

export async function createAddress(
  input: {
    userId: string
    recipientName: string
    phone: string
    province: string
    city?: string
    district?: string
    detail: string
    isDefault?: boolean
  },
  client: DbClient,
) {
  const isDefault = input.isDefault ?? false
  return withDefaultRetry(() =>
    withTransaction(client, async (tx) => {
      const [first] = await tx
        .select()
        .from(schema.addresses)
        .where(eq(schema.addresses.userId, input.userId))
        .limit(1)
      const effectiveDefault = isDefault || !first
      if (effectiveDefault) {
        await tx
          .update(schema.addresses)
          .set({ isDefault: false })
          .where(eq(schema.addresses.userId, input.userId))
      }
      const [address] = await tx
        .insert(schema.addresses)
        .values({
          userId: input.userId,
          recipientName: input.recipientName,
          phone: input.phone,
          province: input.province,
          city: input.city ?? '',
          district: input.district ?? '',
          detail: input.detail,
          isDefault: effectiveDefault,
        })
        .returning()
      return address
    }),
  )
}

export async function listAddressesByUser(userId: string, client: DbClient) {
  const items = await client
    .select()
    .from(schema.addresses)
    .where(eq(schema.addresses.userId, userId))
    .orderBy(desc(schema.addresses.isDefault), schema.addresses.createdAt)
  return { items }
}

export async function getAddressById(
  userId: string,
  addressId: string,
  client: DbClient,
): Promise<Result<typeof schema.addresses.$inferSelect, AddressError>> {
  const [address] = await client
    .select()
    .from(schema.addresses)
    .where(and(eq(schema.addresses.id, addressId), eq(schema.addresses.userId, userId)))
  if (!address) return err('ADDRESS_NOT_FOUND')
  return ok(address)
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: Partial<{
    recipientName: string
    phone: string
    province: string
    city: string
    district: string
    detail: string
    isDefault: boolean
  }>,
  client: DbClient,
): Promise<Result<typeof schema.addresses.$inferSelect, AddressError>> {
  const { isDefault, ...rest } = input
  return withDefaultRetry(() =>
    withTransaction(client, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.addresses)
        .where(and(eq(schema.addresses.id, addressId), eq(schema.addresses.userId, userId)))
      if (!existing) return err('ADDRESS_NOT_FOUND')

      if (isDefault && !existing.isDefault) {
        await tx
          .update(schema.addresses)
          .set({ isDefault: false })
          .where(eq(schema.addresses.userId, userId))
      }
      const [updated] = await tx
        .update(schema.addresses)
        .set({ ...rest, isDefault: isDefault ?? existing.isDefault })
        .where(eq(schema.addresses.id, addressId))
        .returning()
      return ok(updated)
    }),
  )
}

export async function deleteAddress(
  userId: string,
  addressId: string,
  client: DbClient,
): Promise<Result<{ deleted: true }, AddressError>> {
  const [deleted] = await client
    .delete(schema.addresses)
    .where(and(eq(schema.addresses.id, addressId), eq(schema.addresses.userId, userId)))
    .returning()
  if (!deleted) return err('ADDRESS_NOT_FOUND')
  return ok({ deleted: true })
}

// 拼接地址文本: 省市区做串接, 供订单快照/前端展示使用(未上线, 无需兼容旧单行地址)
export function addressText(address: {
  province: string
  city: string
  district: string
  detail: string
}): string {
  return `${address.province}${address.city}${address.district}${address.detail}`
}
