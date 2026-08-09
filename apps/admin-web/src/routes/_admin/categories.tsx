import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../libs/api/client'

// ponytail: 分类量小, 一页拉完不做分页 UI; 超过 100 个时再加分页
const PAGE_SIZE = 100

export const Route = createFileRoute('/_admin/categories')({
  loader: async () => {
    const res = await api.admin.categories.get({ query: { page: 1, pageSize: PAGE_SIZE } })
    if (res.error) throw res.error
    return { categories: res.data }
  },
  component: CategoriesPage,
})

function CategoriesPage() {
  const { categories } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.admin.categories.post({
      name,
      slug,
      ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
    })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '创建失败')
      return
    }
    setName('')
    setSlug('')
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
                <th className="px-4 py-3 font-medium">排序</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {categories.items.map((category) => (
                <tr key={category.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{category.name}</td>
                  <td className="px-4 py-3 text-gray-500">{category.slug}</td>
                  <td className="px-4 py-3">{category.sortOrder}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(category.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => remove(category.id)}
                      className="text-red-600 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
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
