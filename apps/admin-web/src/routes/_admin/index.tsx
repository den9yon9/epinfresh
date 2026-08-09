import { createFileRoute, Link } from '@tanstack/react-router'

import { OrderStatusBadge, ORDER_STATUSES } from '../../components/OrderStatusBadge'
import { api } from '../../libs/api/client'
import type { Dashboard } from '../../libs/api/types'

export const Route = createFileRoute('/_admin/')({
  loader: async () => {
    const res = await api.admin.dashboard.get()
    if (res.error) throw res.error
    return { dashboard: res.data }
  },
  component: DashboardPage,
})

const QUICK_LINKS = [
  { to: '/orders' as const, label: '订单管理' },
  { to: '/products' as const, label: '商品管理' },
  { to: '/categories' as const, label: '分类管理' },
  { to: '/users' as const, label: '用户管理' },
]

function DashboardPage() {
  const { dashboard } = Route.useLoaderData()
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {ORDER_STATUSES.map((status) => (
          <Link
            key={status}
            to="/orders"
            search={{ status }}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-500"
          >
            <OrderStatusBadge status={status} />
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {dashboard[status as keyof Dashboard]}
            </div>
          </Link>
        ))}
      </div>
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">快捷入口</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-700 shadow-sm hover:border-brand-500 hover:text-brand-700"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
