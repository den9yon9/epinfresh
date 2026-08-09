import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import * as v from 'valibot'

import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { api } from '../../libs/api/client'

const PAGE_SIZE = 20

const OrdersSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
})

export const Route = createFileRoute('/orders/')({
  staticData: { title: '我的订单', showBack: true },
  validateSearch: OrdersSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const res = await api.orders.get({ query: { page: deps.page, pageSize: PAGE_SIZE } })
    if (res.error && res.error.status === 401) {
      throw redirect({ to: '/login' })
    }
    if (res.error) {
      throw new Error('订单加载失败，请稍后重试')
    }
    return res.data
  },
  component: OrdersPage,
})

function OrdersPage() {
  const orders = Route.useLoaderData()
  const page = Route.useSearch().page ?? 1
  const totalPages = Math.max(1, Math.ceil(orders.total / orders.pageSize))

  if (orders.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
        <p>还没有订单</p>
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
    <div className="flex flex-col gap-3 pb-8">
      {orders.items.map((order) => (
        <Link
          key={order.id}
          to="/orders/$id"
          params={{ id: order.id }}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {new Date(order.createdAt).toLocaleString()}
            </span>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{order.recipientName}</span>
            <span className="font-semibold text-gray-900">¥{order.totalAmount}</span>
          </div>
        </Link>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 py-2">
          <GoPageButton to={page - 1} disabled={page <= 1} label="上一页" />
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <GoPageButton to={page + 1} disabled={page >= totalPages} label="下一页" />
        </div>
      )}
    </div>
  )
}

function GoPageButton({ to, disabled, label }: { to: number; disabled: boolean; label: string }) {
  return (
    <Link
      to="/orders"
      search={{ page: to }}
      className={`rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 ${
        disabled ? 'pointer-events-none opacity-40' : ''
      }`}
      aria-disabled={disabled}
    >
      {label}
    </Link>
  )
}
