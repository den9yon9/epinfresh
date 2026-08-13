import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import { and, desc, eq } from 'drizzle-orm'

export type AddressError = 'ADDRESS_NOT_FOUND'

export async function createAddress(
  input: {
    userId: string
    recipientName: string
    phone: string
    address: string
    isDefault?: boolean
  },
  client: DbClient,
) {
  const isDefault = input.isDefault ?? false
  return withTransaction(client, async (tx) => {
    // ponytail: 默认唯一性靠事务内先清后设；地址量级小，不需要部分唯一索引
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
        address: input.address,
        isDefault: effectiveDefault,
      })
      .returning()
    return address
  })
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
  input: Partial<{ recipientName: string; phone: string; address: string; isDefault: boolean }>,
  client: DbClient,
): Promise<Result<typeof schema.addresses.$inferSelect, AddressError>> {
  const { isDefault, ...rest } = input
  return withTransaction(client, async (tx) => {
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
  })
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
