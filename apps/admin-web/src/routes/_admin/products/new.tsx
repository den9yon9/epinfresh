import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ProductForm } from '../../../components/ProductForm'
import { api } from '../../../libs/api/client'

export const Route = createFileRoute('/_admin/products/new')({
  loader: async () => {
    const res = await api.admin.categories.get({ query: { page: 1, pageSize: 100 } })
    if (res.error) throw res.error
    return { categories: res.data.items }
  },
  component: NewProductPage,
})

function NewProductPage() {
  const { categories } = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-lg font-semibold text-gray-900">新建商品</h1>
      <ProductForm
        categories={categories}
        submitLabel="创建商品"
        onSubmit={(body) => api.admin.products.post(body)}
        onCancel={() => navigate({ to: '/products' })}
        onDone={() => navigate({ to: '/products' })}
      />
    </div>
  )
}
