import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { api } from '../../libs/api/client'

export const Route = createFileRoute('/orders/$id')({
  staticData: { title: '订单详情', showBack: true },
  loader: async ({ params }) => {
    const res = await api.orders({ id: params.id }).get()
    if (res.error && res.error.status === 401) {
      throw redirect({ to: '/login', search: { redirectTo: `/orders/${params.id}` } })
    }
    if (res.error) {
      throw new Error(res.error.status === 404 ? '订单不存在' : '订单加载失败，请稍后重试')
    }
    return res.data
  },
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const order = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    if (!window.confirm('确认取消该订单？已支付的金额将原路退回')) return
    setError(null)
    setBusy(true)
    const res = await api.orders({ id: order.id }).cancel.post()
    setBusy(false)
    if (res.error) {
      const code = 'error' in res.error.value ? res.error.value.error : undefined
      setError(code === 'INVALID_TRANSITION' ? '订单当前状态不可取消' : '取消失败，请稍后重试')
      return
    }
    router.invalidate()
  }

  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const cancellable = order.status === 'pending' || order.status === 'paid'

  return (
    <div className="flex flex-col gap-4 pb-24">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <OrderStatusBadge status={order.status} />
          <span className="text-xs text-gray-400">
            下单于 {new Date(order.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">共 {totalItems} 件商品</span>
          <span className="text-xl font-bold text-gray-900">¥{order.totalAmount}</span>
        </div>
        {order.trackingNumber && (
          <p className="mt-2 text-sm text-gray-500">运单号：{order.trackingNumber}</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">商品清单</h2>
        <div className="flex flex-col gap-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{item.productName}</p>
                <p className="text-xs text-gray-500">
                  {item.skuName} × {item.quantity}
                </p>
              </div>
              <span className="text-sm text-gray-900">¥{item.subtotal}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">收货信息</h2>
        <p className="text-sm text-gray-900">
          {order.recipientName} {order.recipientPhone}
        </p>
        <p className="text-sm text-gray-600">{order.shippingAddress}</p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {cancellable && (
        <div className="fixed inset-x-0 bottom-14 z-10 border-t border-gray-200 bg-white">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-end px-4">
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-red-300 px-8 py-2.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? '取消中…' : '取消订单'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
