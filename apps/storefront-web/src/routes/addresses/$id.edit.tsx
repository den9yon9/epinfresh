import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { AddressForm } from '../../components/AddressForm'
import { api } from '../../libs/api/client'

export const Route = createFileRoute('/addresses/$id/edit')({
  staticData: { title: '编辑地址', showBack: true },
  loader: async ({ params }) => {
    const res = await api.addresses({ id: params.id }).get()
    if (res.error) {
      throw new Error(res.error.status === 404 ? '地址不存在' : '地址加载失败，请稍后重试')
    }
    return res.data
  },
  component: EditAddressPage,
})

function EditAddressPage() {
  const address = Route.useLoaderData()
  const navigate = useNavigate()
  return (
    <AddressForm
      initial={address}
      submitLabel="保存"
      onSubmit={(values) => api.addresses({ id: address.id }).put(values)}
      onDone={() => navigate({ to: '/addresses' })}
    />
  )
}
