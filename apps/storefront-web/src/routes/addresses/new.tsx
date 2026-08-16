import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'

import { AddressForm } from '../../components/AddressForm'
import { api } from '../../libs/api/client'

// 从结算页进入时带上 from=checkout, 保存后直接回结算页而不是地址列表
const NewAddressSearchSchema = v.object({
  from: v.optional(v.picklist(['checkout'])),
})

export const Route = createFileRoute('/addresses/new')({
  staticData: { title: '新增地址', showBack: true },
  validateSearch: NewAddressSearchSchema,
  component: NewAddressPage,
})

function NewAddressPage() {
  const navigate = useNavigate()
  const { from } = Route.useSearch()
  return (
    <AddressForm
      submitLabel="保存"
      onSubmit={(values) => api.addresses.post(values)}
      onDone={() =>
        from === 'checkout'
          ? navigate({ to: '/checkout', replace: true })
          : navigate({ to: '/addresses' })
      }
    />
  )
}
