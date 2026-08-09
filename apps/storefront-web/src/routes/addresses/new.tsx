import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { AddressForm } from '../../components/AddressForm'
import { api } from '../../libs/api/client'

export const Route = createFileRoute('/addresses/new')({
  staticData: { title: '新增地址', showBack: true },
  component: NewAddressPage,
})

function NewAddressPage() {
  const navigate = useNavigate()
  return (
    <AddressForm
      submitLabel="保存"
      onSubmit={(values) => api.addresses.post(values)}
      onDone={() => navigate({ to: '/addresses' })}
    />
  )
}
