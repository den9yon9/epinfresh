import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import * as v from 'valibot'
import { useState } from 'react'

import { api } from '../libs/api/client'
import { clearSessionCache, isUnauthorized } from '../libs/api/session'

const PaySearchSchema = v.object({
  orderId: v.string(),
})

export const Route = createFileRoute('/pay')({
  staticData: { title: '支付', showBack: true },
  validateSearch: PaySearchSchema,
  loaderDeps: ({ search }) => ({ orderId: search.orderId }),
  loader: async ({ deps }) => {
    const res = await api.orders({ id: deps.orderId }).get()
    if (isUnauthorized(res.error)) {
      clearSessionCache()
      throw redirect({ to: '/login', search: { redirectTo: `/pay?orderId=${deps.orderId}` } })
    }
    if (res.error) {
      throw new Error(res.error.status === 404 ? '订单不存在' : '订单加载失败，请稍后重试')
    }
    return res.data
  },
  component: PayPage,
})

const PAID_STATUSES = new Set(['paid', 'shipped', 'completed'])

function PayPage() {
  const order = Route.useLoaderData()
  const { orderId } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState(PAID_STATUSES.has(order.status))

  async function pay() {
    setError(null)
    setBusy(true)
    const initiated = await api.orders({ id: orderId }).pay.post()
    if (initiated.error) {
      setBusy(false)
      const code = 'error' in initiated.error.value ? initiated.error.value.error : undefined
      setError(code === 'ORDER_NOT_PENDING' ? '订单已支付或状态已变化' : '支付失败，请稍后重试')
      return
    }
    // mock 网关: 发起后立即确认回调
    const confirmed = await api.payments({ id: initiated.data.id }).confirm.post()
    setBusy(false)
    if (confirmed.error) {
      setError('支付确认失败，请刷新后重试')
      return
    }
    setPaid(true)
  }

  if (paid) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-gray-900">支付成功</h2>
        <p className="text-sm text-gray-500">
          订单金额 <span className="font-semibold text-gray-900">¥{order.totalAmount}</span>
        </p>
        <Link
          to="/orders/$id"
          params={{ id: order.id }}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          查看订单
        </Link>
      </div>
    )
  }

  if (order.status !== 'pending') {
    const labels: Record<string, string> = {
      cancelled: '订单已取消',
      refunded: '订单已退款',
    }
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl text-gray-400">
          !
        </div>
        <h2 className="text-lg font-semibold text-gray-900">
          {labels[order.status] ?? '订单状态已变化'}
        </h2>
        <Link
          to="/orders/$id"
          params={{ id: order.id }}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          查看订单
        </Link>
      </div>
    )
  }

  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="flex flex-col gap-4 pb-24">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">订单信息</h2>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">订单号</span>
          <span className="text-gray-900">{order.id.slice(0, 8)}…</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">商品数</span>
          <span className="text-gray-900">{totalItems} 件</span>
        </div>
        <div className="mt-2 flex justify-between text-base">
          <span className="text-gray-900">应付金额</span>
          <span className="font-bold text-gray-900">¥{order.totalAmount}</span>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="text-sm text-gray-500">
            合计 <span className="text-lg font-bold text-gray-900">¥{order.totalAmount}</span>
          </div>
          <button
            onClick={pay}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? '支付中…' : '确认支付'}
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-gray-400">mock 支付环境，点击即支付成功</p>
    </div>
  )
}
