import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import * as v from 'valibot'

import { api } from '../../../libs/api/client'

const PAGE_SIZE = 20

const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const
const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已上架',
  archived: '已归档',
}
const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

const ProductsSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  status: v.optional(v.picklist([...PRODUCT_STATUSES] as [string, ...string[]])),
})

export const Route = createFileRoute('/_admin/products/')({
  validateSearch: ProductsSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page, status: search.status }),
  loader: async ({ deps }) => {
    const res = await api.admin.products.get({
      query: {
        page: deps.page,
        pageSize: PAGE_SIZE,
        ...(deps.status ? { status: deps.status } : {}),
      },
    })
    if (res.error) throw res.error
    return { products: res.data }
  },
  component: ProductsPage,
})

function ProductsPage() {
  const { products } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const page = search.page ?? 1

  const selectStatus = (status?: string) =>
    navigate({
      to: '/products',
      search: () => ({ page: 1, status }),
      replace: true,
    })
  const goPage = (next: number) =>
    navigate({
      to: '/products',
      search: () => ({ page: next, status: search.status }),
      replace: true,
    })

  async function removeProduct(id: string) {
    if (!window.confirm('确认删除该商品？关联的 SKU 将一并删除')) return
    setError(null)
    const res = await api.admin.products({ id }).delete()
    if (res.error) {
      setError(res.error.value.message ?? '删除失败')
      return
    }
    router.invalidate()
  }

  const totalPages = Math.max(1, Math.ceil(products.total / products.pageSize))

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectStatus(undefined)}
            className={`rounded-full px-3 py-1 text-sm ${
              search.status === undefined
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            全部
          </button>
          {PRODUCT_STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => selectStatus(status)}
              className={`rounded-full px-3 py-1 text-sm ${
                search.status === status
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
        <Link
          to="/products/new"
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          新建商品
        </Link>
      </div>

      {products.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">暂无商品</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">SKU 数</th>
                <th className="px-4 py-3 font-medium">最低价</th>
                <th className="px-4 py-3 font-medium">更新时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {products.items.map((product) => (
                <tr key={product.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{product.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_BADGES[product.status]}`}
                    >
                      {STATUS_LABELS[product.status] ?? product.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{product.skus.length}</td>
                  <td className="px-4 py-3">
                    {product.skus.length > 0
                      ? `¥${Math.min(...product.skus.map((s) => Number(s.price))).toFixed(2)}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(product.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        to="/products/$id"
                        params={{ id: product.id }}
                        className="text-brand-600 hover:underline"
                      >
                        编辑
                      </Link>
                      <button
                        onClick={() => removeProduct(product.id)}
                        className="text-red-600 hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 py-2">
        <button
          onClick={() => goPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          上一页
        </button>
        <span className="text-sm text-gray-500">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}
