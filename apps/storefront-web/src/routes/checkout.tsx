import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../libs/api/client'
import type { Address } from '../libs/api/types'

export const Route = createFileRoute('/checkout')({
  staticData: { title: '结算', showBack: true },
  loader: async () => {
    const [cartRes, addressesRes] = await Promise.all([api.cart.get(), api.addresses.get()])
    if (cartRes.error && cartRes.error.status === 401) {
      throw redirect({ to: '/login', search: { redirectTo: '/checkout' } })
    }
    if (cartRes.error || addressesRes.error) {
      throw new Error('结算信息加载失败，请稍后重试')
    }
    return { cart: cartRes.data, addresses: addressesRes.data.items }
  },
  component: CheckoutPage,
})

function CheckoutPage() {
  const { cart, addresses } = Route.useLoaderData()
  const navigate = useNavigate()
  const defaultAddr = addresses.find((a) => a.isDefault)
  const [addressId, setAddressId] = useState<string | undefined>(defaultAddr?.id)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 幂等键: 每次进入结算页生成一次, 防双提交/重试产生重复订单
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const total = cart.items.reduce((sum, item) => sum + Number(item.sku.price) * item.quantity, 0)

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
        <p>购物车是空的，先去挑点东西吧</p>
        <Link
          to="/"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          去逛逛
        </Link>
      </div>
    )
  }

  async function submit() {
    if (!addressId) return
    setError(null)
    setSubmitting(true)
    const res = await api.orders.post(
      {
        items: cart.items.map((item) => ({ skuId: item.sku.id, quantity: item.quantity })),
        addressId,
      },
      { headers: { 'idempotency-key': idempotencyKey } },
    )
    setSubmitting(false)
    if (res.error) {
      const messages: Record<string, string> = {
        SKU_NOT_FOUND: '部分商品不存在，请返回购物车调整',
        PRODUCT_UNAVAILABLE: '部分商品已下架，请返回购物车调整',
        INSUFFICIENT_STOCK: '部分商品库存不足，请返回购物车调整',
        ADDRESS_NOT_FOUND: '收货地址无效，请重新选择',
      }
      const code = 'error' in res.error.value ? res.error.value.error : undefined
      setError((code ? messages[code] : undefined) ?? '下单失败，请稍后重试')
      return
    }
    navigate({ to: '/pay', search: { orderId: res.data.id } })
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">收货地址</h2>
          <Link to="/addresses" className="text-sm text-brand-600 hover:underline">
            管理地址
          </Link>
        </div>
        {addresses.length === 0 ? (
          <Link
            to="/addresses/new"
            className="block rounded-lg border border-dashed border-gray-300 py-4 text-center text-sm text-gray-400 hover:border-brand-500"
          >
            + 新增收货地址
          </Link>
        ) : (
          <div className="flex flex-col gap-2">
            {addresses.map((addr: Address) => (
              <label
                key={addr.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  addressId === addr.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={addressId === addr.id}
                  onChange={() => setAddressId(addr.id)}
                  className="mt-1 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{addr.recipientName}</span>
                    <span className="text-sm text-gray-500">{addr.phone}</span>
                    {addr.isDefault && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                        默认
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-gray-600">{addr.address}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">商品清单</h2>
        <div className="flex flex-col gap-3">
          {cart.items.map((item) => (
            <div key={item.sku.id} className="flex items-center gap-3">
              {item.product.images[0] ? (
                <img
                  src={item.product.images[0]}
                  alt={item.product.name}
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-gray-100" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{item.product.name}</p>
                <p className="text-xs text-gray-500">
                  {item.sku.name} × {item.quantity}
                </p>
              </div>
              <span className="text-sm text-gray-900">
                ¥{(Number(item.sku.price) * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="text-sm text-gray-500">
            合计 <span className="text-lg font-bold text-gray-900">¥{total.toFixed(2)}</span>
          </div>
          <button
            onClick={submit}
            disabled={!addressId || submitting}
            className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      </div>
    </div>
  )
}
