import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { QuantityStepper } from '../components/QuantityStepper'
import { Toast } from '../components/Toast'
import { api } from '../libs/api/client'
import type { CartItem } from '../libs/api/types'

export const Route = createFileRoute('/cart')({
  staticData: { title: '购物车' },
  loader: async () => {
    const res = await api.cart.get()
    if (res.error && res.error.status === 401) {
      throw redirect({ to: '/login', search: { redirectTo: '/cart' } })
    }
    if (res.error) {
      throw new Error('购物车加载失败，请稍后重试')
    }
    return res.data
  },
  component: CartPage,
})

function CartPage() {
  const cart = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [busySkuId, setBusySkuId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const total = cart.items.reduce((sum, item) => sum + Number(item.sku.price) * item.quantity, 0)

  function flash(msg: string) {
    setNotice(msg)
  }

  // ponytail: 全局串行锁, 防连点竞态; 并发量上来再改 per-sku 锁
  async function changeQuantity(item: CartItem, quantity: number) {
    if (busySkuId !== null) return
    setBusySkuId(item.sku.id)
    const res = await api.cart.items({ skuId: item.sku.id }).put({ quantity })
    setBusySkuId(null)
    if (res.error) {
      if (res.error.status === 401) {
        void navigate({ to: '/login', search: { redirectTo: '/cart' } })
      } else if (res.error.status === 404) {
        flash('该商品已不在购物车中')
        router.invalidate()
      } else {
        flash('修改数量失败，请稍后重试')
      }
      return
    }
    router.invalidate()
  }

  async function remove(skuId: string) {
    setBusySkuId(skuId)
    const res = await api.cart.items({ skuId }).delete()
    setBusySkuId(null)
    if (res.error) {
      if (res.error.status === 401) {
        void navigate({ to: '/login', search: { redirectTo: '/cart' } })
      } else {
        flash('删除失败，请稍后重试')
      }
      return
    }
    router.invalidate()
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
        <p>购物车是空的</p>
        <Link
          to="/"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          去逛逛
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {cart.items.map((item) => (
        <div
          key={item.sku.id}
          className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
        >
          {item.product.images[0] ? (
            <img
              src={item.product.images[0]}
              alt={item.product.name}
              className="h-20 w-20 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="h-20 w-20 shrink-0 rounded-lg bg-gray-100" />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{item.product.name}</p>
                <p className="text-xs text-gray-500">{item.sku.name}</p>
              </div>
              <button
                onClick={() => remove(item.sku.id)}
                disabled={busySkuId === item.sku.id}
                className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40"
              >
                删除
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-700">¥{Number(item.sku.price).toFixed(2)}</span>
              <QuantityStepper
                value={item.quantity}
                min={1}
                max={item.sku.stock}
                onChange={(q) => changeQuantity(item, q)}
              />
            </div>
          </div>
        </div>
      ))}

      {notice && <Toast message={notice} onDismiss={() => setNotice(null)} />}

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="text-sm text-gray-500">
            合计 <span className="text-lg font-bold text-gray-900">¥{total.toFixed(2)}</span>
          </div>
          <button
            onClick={() => navigate({ to: '/checkout' })}
            className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700"
          >
            去结算
          </button>
        </div>
      </div>
    </div>
  )
}
