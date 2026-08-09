import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../../libs/api/client'
import type { Category, CreateProductBody, ProductStatus } from '../../../libs/api/types'

const STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已上架' },
  { value: 'archived', label: '已归档' },
]

interface SkuFormRow {
  name: string
  skuCode: string
  price: string
  stock: string
  attributesText: string
}

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
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [imagesText, setImagesText] = useState('')
  const [status, setStatus] = useState<ProductStatus>('draft')
  const [categoryId, setCategoryId] = useState('')
  const [skus, setSkus] = useState<SkuFormRow[]>([
    { name: '', skuCode: '', price: '', stock: '', attributesText: '' },
  ])

  function parseAttributes(text: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    for (const line of text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      const eq = line.indexOf('=')
      if (eq <= 0) {
        setError(`属性格式错误: "${line}" (应为 键=值, 每行一个)`)
        throw new Error('bad attributes')
      }
      attrs[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return attrs
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    let body: CreateProductBody
    try {
      body = {
        name,
        slug,
        description: description || undefined,
        status,
        ...(categoryId ? { categoryId } : {}),
        images: imagesText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        skus: skus
          .filter((s) => s.name || s.skuCode || s.price)
          .map((s) => ({
            name: s.name,
            skuCode: s.skuCode,
            price: Number(s.price),
            stock: s.stock ? Number(s.stock) : 0,
            attributes: parseAttributes(s.attributesText),
          })),
      }
    } catch {
      setSubmitting(false)
      return
    }

    const res = await api.admin.products.post(body)
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '创建失败')
      return
    }
    navigate({ to: '/products' })
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-lg font-semibold text-gray-900">新建商品</h1>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">基本信息</h2>
        <div className="grid gap-4 md:grid-cols-2">
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
          <Field label="分类">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputCls}
            >
              <option value="">无</option>
              {categories.map((c: Category) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="状态">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
              className={inputCls}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="描述" className="md:col-span-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputCls}
            />
          </Field>
          <Field label="图片 URL（每行一个）" className="md:col-span-2">
            <textarea
              value={imagesText}
              onChange={(e) => setImagesText(e.target.value)}
              rows={2}
              placeholder="https://example.com/a.jpg"
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">SKU</h2>
          <button
            type="button"
            onClick={() =>
              setSkus([
                ...skus,
                { name: '', skuCode: '', price: '', stock: '', attributesText: '' },
              ])
            }
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            + 添加 SKU
          </button>
        </div>
        {skus.map((sku, i) => (
          <div key={i} className="mb-4 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-6">
            <Field label="名称" className="md:col-span-2">
              <input
                value={sku.name}
                onChange={(e) => setSku(i, { ...sku, name: e.target.value })}
                required
                className={inputCls}
              />
            </Field>
            <Field label="SKU 编码">
              <input
                value={sku.skuCode}
                onChange={(e) => setSku(i, { ...sku, skuCode: e.target.value })}
                required
                className={inputCls}
              />
            </Field>
            <Field label="价格（元）">
              <input
                type="number"
                min="0"
                step="0.01"
                value={sku.price}
                onChange={(e) => setSku(i, { ...sku, price: e.target.value })}
                required
                className={inputCls}
              />
            </Field>
            <Field label="库存">
              <input
                type="number"
                min="0"
                value={sku.stock}
                onChange={(e) => setSku(i, { ...sku, stock: e.target.value })}
                className={inputCls}
              />
            </Field>
            <button
              type="button"
              onClick={() => setSkus(skus.filter((_, j) => j !== i))}
              disabled={skus.length === 1}
              className="self-end rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600 disabled:opacity-40"
            >
              删除
            </button>
            <Field label="属性（每行 键=值）" className="md:col-span-6">
              <textarea
                value={sku.attributesText}
                onChange={(e) => setSku(i, { ...sku, attributesText: e.target.value })}
                rows={1}
                placeholder={'规格=1kg'}
                className={inputCls}
              />
            </Field>
          </div>
        ))}
      </section>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: '/products' })}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? '提交中…' : '创建商品'}
        </button>
      </div>
    </form>
  )

  function setSku(index: number, row: SkuFormRow) {
    setSkus(skus.map((r, j) => (j === index ? row : r)))
  }
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none'

function Field({
  label,
  required,
  className = '',
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm text-gray-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}
