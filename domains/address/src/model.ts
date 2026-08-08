import { table } from '@epinfresh/database'
import { Type } from '@sinclair/typebox'

export const AddressResponseSchema = table.select.address

export const AddressListResponseSchema = Type.Object({
  items: Type.Array(table.select.address),
})

export const CreateAddressInputSchema = Type.Omit(table.insert.address, ['userId'])

export const UpdateAddressInputSchema = table.update.address
