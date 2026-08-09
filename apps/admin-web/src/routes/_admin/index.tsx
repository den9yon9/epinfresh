import { createFileRoute, Link } from '@tanstack/react-router'

import { api } from '../../libs/api/client'
import type { Dashboard } from '../../libs/api/types'

const STATUS_META: Record<keyof Dashboard, { label: string; badge: string }> = {
  pending: { label: '待支付', badge: 'bg-amber-100 text-amber-700' },
  paid: { label: '已支付', badge: 'bg-blue-100 text-blue-700' },
  shipped: { label: '已发货', badge: 'bg-indigo-100 text-indigo-700' },
  completed: { label: '已完成', badge: 'bg-green-100 text-green-700' },
  refunded: { label: '已退款', badge: 'bg-gray-100 text-gray-600' },
  cancelled: { label: '已取消', badge: 'bg-red-100 text-red-600' },
}

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
        {(Object.keys(STATUS_META) as (keyof Dashboard)[]).map((status) => (
          <div key={status} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div
              className={`mb-2 inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_META[status].badge}`}
            >
              {STATUS_META[status].label}
            </div>
            <div className="text-3xl font-bold text-gray-900">{dashboard[status]}</div>
          </div>
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
