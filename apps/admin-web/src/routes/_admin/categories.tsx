import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../libs/api/client'

const PAGE_SIZE = 20

type Category = Awaited<ReturnType<typeof loadCategories>>['items'][number]

async function loadCategories({ page }: { page: number }) {
  const res = await api.admin.categories.get({
    query: { page, pageSize: PAGE_SIZE },
  })
  if (res.error) throw res.error
  return res.data
}

export const Route = createFileRoute('/_admin/categories')({
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  validateSearch: (search: Record<string, unknown>): { page?: number } => ({
    page: typeof search.page === 'number' && search.page > 0 ? search.page : undefined,
  }),
  loader: ({ deps }) => loadCategories(deps),
  component: CategoriesPage,
})

function CategoriesPage() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const { page = 1 } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const rows = buildRows(categories.items)
  const totalPages = Math.max(1, Math.ceil(categories.total / PAGE_SIZE))

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.admin.categories.post({
      name,
      slug,
      ...(parentId ? { parentId } : {}),
      ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
    })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '创建失败')
      return
    }
    setName('')
    setSlug('')
    setParentId('')
    setSortOrder('')
    setShowForm(false)
    router.invalidate()
  }

  async function remove(id: string) {
    if (!window.confirm('确认删除该分类？')) return
    setError(null)
    const res = await api.admin.categories({ id }).delete()
    if (res.error) {
      setError(res.error.value.message ?? '删除失败')
      return
    }
    router.invalidate()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 分页导航 */}
      <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
        <span>
          共 {categories.total} 条 · 第 {page}/{totalPages} 页
        </span>
        <button
          disabled={page <= 1}
          onClick={() => void router.navigate({ to: '/categories', search: { page: page - 1 } })}
          className="rounded-lg border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-40"
        >
          上一页
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => void router.navigate({ to: '/categories', search: { page: page + 1 } })}
          className="rounded-lg border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-40"
        >
          下一页
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          {showForm ? '收起' : '新建分类'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={create}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <Field label="名称" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputCls}
            />
          </Field>
          <Field label="Slug" required>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className={inputCls}
            />
          </Field>
          <Field label="父级">
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={inputCls}
            >
              <option value="">无（顶级）</option>
              {categories.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="排序">
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className={inputCls}
            />
          </Field>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '创建'}
          </button>
        </form>
      )}

      {categories.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">暂无分类</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">父级</th>
                <th className="px-4 py-3 font-medium">排序</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cat, depth }) =>
                editingId === cat.id ? (
                  <CategoryEditRow
                    key={cat.id}
                    category={cat}
                    options={categories.items}
                    onCancel={() => setEditingId(null)}
                    onError={setError}
                    onSaved={() => {
                      setEditingId(null)
                      router.invalidate()
                    }}
                  />
                ) : (
                  <tr key={cat.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <span style={{ paddingLeft: depth * 20 }} className="inline-block">
                        {depth > 0 && <span className="mr-2 text-gray-300">└</span>}
                        {cat.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{cat.slug}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {parentName(categories.items, cat.parentId)}
                    </td>
                    <td className="px-4 py-3">{cat.sortOrder}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(cat.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditingId(cat.id)}
                          className="text-brand-600 hover:underline"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => remove(cat.id)}
                          className="text-red-600 hover:underline"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CategoryEditRow({
  category,
  options,
  onCancel,
  onError,
  onSaved,
}: {
  category: Category
  options: Category[]
  onCancel: () => void
  onError: (msg: string) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(category.name)
  const [slug, setSlug] = useState(category.slug)
  const [parentId, setParentId] = useState(category.parentId ?? '')
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await api.admin.categories({ id: category.id }).patch({
      name,
      slug,
      ...(parentId ? { parentId } : {}),
      sortOrder: Number(sortOrder),
    })
    setSaving(false)
    if (res.error) {
      onError(res.error.value.message ?? '保存失败')
      return
    }
    onSaved()
  }

  return (
    <tr className="border-b border-gray-100 bg-brand-50/50 last:border-0">
      <td className="px-4 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </td>
      <td className="px-4 py-2">
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className={inputCls} />
      </td>
      <td className="px-4 py-2">
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
          <option value="">无（顶级）</option>
          {options
            .filter((c) => c.id !== category.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className={`${inputCls} w-20`}
        />
      </td>
      <td className="px-4 py-2 text-gray-500">{new Date(category.createdAt).toLocaleString()}</td>
      <td className="px-4 py-2">
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="text-brand-600 hover:underline disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={onCancel} className="text-gray-500 hover:underline">
            取消
          </button>
        </div>
      </td>
    </tr>
  )
}

function buildRows(categories: Category[]): { cat: Category; depth: number }[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const children = new Map<string, Category[]>()
  const roots: Category[] = []
  for (const c of categories) {
    if (c.parentId && byId.has(c.parentId)) {
      const list = children.get(c.parentId) ?? []
      list.push(c)
      children.set(c.parentId, list)
    } else {
      roots.push(c)
    }
  }
  const orderBySort = (list: Category[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder)
  const rows: { cat: Category; depth: number }[] = []
  const visit = (list: Category[], depth: number) => {
    for (const c of orderBySort(list)) {
      rows.push({ cat: c, depth })
      const kids = children.get(c.id)
      if (kids) visit(kids, depth + 1)
    }
  }
  visit(orderBySort(roots), 0)
  return rows
}

function parentName(categories: Category[], parentId: string | null): string {
  if (!parentId) return '-'
  return categories.find((c) => c.id === parentId)?.name ?? '-'
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-gray-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}
