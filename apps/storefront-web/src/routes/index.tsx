import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'

import { CategoryChips } from '../components/CategoryChips'
import { ProductCard } from '../components/ProductCard'
import { api } from '../libs/api/client'

const PAGE_SIZE = 10

// search 校验（Standard Schema）：loader 传参时 eden 类型会强制与后端契约一致
const HomeSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  categoryId: v.optional(v.string()),
  q: v.optional(v.string()),
})

export const Route = createFileRoute('/')({
  validateSearch: HomeSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page, categoryId: search.categoryId, q: search.q }),
  loader: async ({ deps }) => {
    const [productsRes, categoriesRes] = await Promise.all([
      api.products.get({
        query: {
          page: deps.page,
          pageSize: PAGE_SIZE,
          ...(deps.categoryId ? { categoryId: deps.categoryId } : {}),
          ...(deps.q ? { q: deps.q } : {}),
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
    navigate({ to: '/', search: () => ({ page: 1, categoryId, q: search.q }), replace: true })
  const goPage = (next: number) =>
    navigate({
      to: '/',
      search: () => ({ page: next, categoryId: search.categoryId, q: search.q }),
      replace: true,
    })

  const totalPages = Math.max(1, Math.ceil(products.total / products.pageSize))

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const q = new FormData(e.currentTarget).get('q') as string
          navigate({
            to: '/',
            search: () => ({ page: 1, q: q.trim() || undefined }),
            replace: true,
          })
        }}
        className="flex gap-2"
      >
        <input
          name="q"
          defaultValue={search.q ?? ''}
          placeholder="搜索商品"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          搜索
        </button>
      </form>
      <CategoryChips
        categories={categories.items}
        activeId={search.categoryId}
        onSelect={selectCategory}
      />
      {products.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">
          {search.q ? `没有找到与「${search.q}」相关的商品` : '该分类暂无商品'}
        </p>
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
