import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../libs/api/client'
import { QuantityStepper } from '../components/QuantityStepper'

export const Route = createFileRoute('/products/$id')({
  staticData: { title: '商品详情', showBack: true },
  loader: async ({ params }) => {
    const res = await api.products({ id: params.id }).get()
    if (res.error) {
      throw new Error(res.error.status === 404 ? '商品不存在' : '商品加载失败，请稍后重试')
    }
    return res.data
  },
  component: ProductDetailPage,
})

function ProductDetailPage() {
  const product = Route.useLoaderData()
  const navigate = useNavigate()
  const [selectedSkuId, setSelectedSkuId] = useState(product.skus[0]?.id)
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const sku = product.skus.find((s) => s.id === selectedSkuId) ?? product.skus[0]
  const image = product.images[0]

  const addToCart = async () => {
    if (!sku) return
    setBusy(true)
    const res = await api.cart.items.post({ skuId: sku.id, quantity })
    setBusy(false)
    if (res.error) {
      if (res.error.status === 401) {
        void navigate({ to: '/login' })
        return
      }
      setNotice('加入购物车失败，请稍后重试')
      return
    }
    setNotice('已加入购物车')
    setTimeout(() => setNotice(null), 2000)
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {image ? (
        <img
          src={image}
          alt={product.name}
          className="aspect-square w-full rounded-xl object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-brand-50 text-gray-300">
          无图
        </div>
      )}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">{product.name}</h1>
        <p className="mt-1 text-sm text-gray-500">{product.description}</p>
        {sku && (
          <p className="mt-3 text-brand-600">
            <span className="text-2xl font-bold">¥{Number(sku.price).toFixed(2)}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-800">选择规格</p>
        <div className="flex flex-wrap gap-2">
          {product.skus.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSkuId(s.id)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                s.id === sku?.id
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              {s.name}
              <span className="ml-1 text-gray-400">¥{Number(s.price).toFixed(2)}</span>
            </button>
          ))}
        </div>
        {sku && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">购买数量（库存 {sku.stock}）</p>
            <QuantityStepper value={quantity} max={sku.stock} onChange={setQuantity} />
          </div>
        )}
      </div>

      {notice && (
        <div className="fixed inset-x-0 top-20 z-20 mx-auto w-fit rounded-full bg-gray-900/80 px-4 py-1.5 text-sm text-white">
          {notice}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white p-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            onClick={addToCart}
            disabled={busy || !sku || sku.stock <= 0}
            className="h-12 flex-1 rounded-xl bg-brand-600 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? '加入中…' : sku && sku.stock <= 0 ? '已售罄' : '加入购物车'}
          </button>
        </div>
      </div>
    </div>
  )
}
