import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { api } from '../api/client'
import { CategoryChips } from '../components/CategoryChips'
import { ProductCard } from '../components/ProductCard'

interface HomeSearch {
  page?: number
  categoryId?: string
}

const PAGE_SIZE = 10

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const page = Number(search.page)
    return {
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    }
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, categoryId: search.categoryId }),
  loader: async ({ deps }) => {
    const [productsRes, categoriesRes] = await Promise.all([
      api.products.get({
        query: {
          page: deps.page,
          pageSize: PAGE_SIZE,
          ...(deps.categoryId ? { categoryId: deps.categoryId } : {}),
        },
      }),
      api.categories.get({ query: { page: 1, pageSize: 100 } }),
    ])
    if (productsRes.error) throw productsRes.error
    if (categoriesRes.error) throw categoriesRes.error
    return { products: productsRes.data, categories: categoriesRes.data }
  },
  component: HomePage,
})

function HomePage() {
  const { products, categories } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const page = search.page ?? 1

  const selectCategory = (categoryId?: string) =>
    navigate({ to: '/', search: () => ({ page: 1, categoryId }), replace: true })
  const goPage = (next: number) =>
    navigate({
      to: '/',
      search: () => ({ page: next, categoryId: search.categoryId }),
      replace: true,
    })

  const totalPages = Math.max(1, Math.ceil(products.total / products.pageSize))

  return (
    <div className="flex flex-col gap-4">
      <CategoryChips
        categories={categories.items}
        activeId={search.categoryId}
        onSelect={selectCategory}
      />
      {products.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">该分类暂无商品</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {products.items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
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
