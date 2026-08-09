import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ProductForm } from '../../../components/ProductForm'
import { api } from '../../../libs/api/client'

export const Route = createFileRoute('/_admin/products/$id')({
  loader: async ({ params }) => {
    const [detailRes, categoriesRes] = await Promise.all([
      api.admin.products({ id: params.id }).get(),
      api.admin.categories.get({ query: { page: 1, pageSize: 100 } }),
    ])
    if (detailRes.error) throw detailRes.error
    if (categoriesRes.error) throw categoriesRes.error
    return { product: detailRes.data, categories: categoriesRes.data.items }
  },
  component: EditProductPage,
})

function EditProductPage() {
  const { product, categories } = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-lg font-semibold text-gray-900">编辑商品</h1>
      <ProductForm
        categories={categories}
        initial={product}
        submitLabel="保存"
        onSubmit={(body) => api.admin.products({ id: product.id }).put(body)}
        onCancel={() => navigate({ to: '/products' })}
        onDone={() => navigate({ to: '/products' })}
      />
    </div>
  )
}
