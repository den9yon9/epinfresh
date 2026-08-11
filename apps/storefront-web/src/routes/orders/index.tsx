import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'

import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { api } from '../../libs/api/client'

const PAGE_SIZE = 20

const STATUS_TABS = [
  { key: undefined, label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '已支付' },
  { key: 'shipped', label: '已发货' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: 'refunded', label: '已退款' },
] as const

const OrdersSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  status: v.optional(
    v.picklist(['pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded']),
  ),
})

export const Route = createFileRoute('/orders/')({
  staticData: { title: '我的订单', showBack: true },
  validateSearch: OrdersSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page, status: search.status }),
  loader: async ({ deps }) => {
    const res = await api.orders.get({
      query: {
        page: deps.page,
        pageSize: PAGE_SIZE,
        ...(deps.status ? { status: deps.status } : {}),
      },
    })
    if (res.error && res.error.status === 401) {
      throw redirect({ to: '/login', search: { redirectTo: '/orders' } })
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
  const search = Route.useSearch()
  const navigate = useNavigate()
  const page = search.page ?? 1
  const totalPages = Math.max(1, Math.ceil(orders.total / orders.pageSize))

  const selectStatus = (status: (typeof STATUS_TABS)[number]['key']) =>
    navigate({ to: '/orders', search: { page: 1, status }, replace: true })

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
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => selectStatus(tab.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${
              search.status === tab.key ? 'bg-brand-600 text-white' : 'bg-white text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {orders.items.map((order) => (
        <div key={order.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Link to="/orders/$id" params={{ id: order.id }}>
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
          {order.status === 'pending' && (
            <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
              <Link
                to="/pay"
                search={{ orderId: order.id }}
                className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700"
              >
                去支付
              </Link>
            </div>
          )}
        </div>
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
