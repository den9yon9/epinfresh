import { useRef, useState } from 'react'

import type { Category, CreateProductBody, ProductDetail, ProductStatus } from '../libs/api/types'

const STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已上架' },
  { value: 'archived', label: '已归档' },
]

interface SkuFormRow {
  id?: string
  name: string
  skuCode: string
  price: string
  stock: string
  attributesText: string
}

interface ProductFormProps {
  categories: Category[]
  initial?: ProductDetail
  submitLabel: string
  onSubmit: (body: CreateProductBody) => Promise<{ error: { value: { message?: string } } | null }>
  onCancel: () => void
  onDone: () => void
}

export function ProductForm({
  categories,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDone,
}: ProductFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [imagesText, setImagesText] = useState(initial?.images.join('\n') ?? '')
  const [status, setStatus] = useState<ProductStatus>(initial?.status ?? 'draft')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [skus, setSkus] = useState<SkuFormRow[]>(
    initial?.skus.map((s) => ({
      id: s.id,
      name: s.name,
      skuCode: s.skuCode,
      price: s.price,
      stock: String(s.stock),
      attributesText: Object.entries(s.attributes)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    })) ?? [{ name: '', skuCode: '', price: '', stock: '', attributesText: '' }],
  )

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

  function handleUpload() {
    fileRef.current?.click()
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/admin/upload', { method: 'POST', body: form })
      const data = (await res.json()) as { url?: string; error?: string; message?: string }
      if (!res.ok || !data.url) {
        setError(data.message ?? '上传失败，请重试')
        return
      }
      setImagesText((prev) => `${prev.trimEnd()}${prev.trimEnd() ? '\n' : ''}${data.url}`)
    } catch {
      setError('上传失败，请重试')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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
            ...(s.id ? { id: s.id } : {}),
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

    const res = await onSubmit(body)
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '保存失败')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
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
              {categories.map((c) => (
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
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              {uploading ? '上传中…' : '本地上传图片'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onFileChosen}
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
          <div
            key={sku.id ?? i}
            className="mb-4 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-6"
          >
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
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? '提交中…' : submitLabel}
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
