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

const LOW_STOCK_TEXT = '库存告警'

function DashboardPage() {
  const { dashboard } = Route.useLoaderData()

  return (
    <div className="flex flex-col gap-6">
      {/* KPI 核心指标卡 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="今日 GMV"
          value={`¥${dashboard.todayGmv}`}
          sub={`今日订单 ${dashboard.todayOrders} 单`}
        />
        <KpiCard
          label="累计 GMV"
          value={`¥${dashboard.totalGmv}`}
          sub={`累计订单 ${dashboard.totalOrders} 单`}
        />
        <KpiCard
          label="待发货订单"
          value={String(dashboard.orderCounts.paid)}
          sub={`已发货 ${dashboard.orderCounts.shipped}`}
        />
        <KpiCard
          label="低库存预警"
          value={String(dashboard.lowStock.length)}
          sub={`注册用户 ${dashboard.totalUsers} 人`}
          alert={dashboard.lowStock.length > 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 订单状态分布 */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">订单状态分布</h2>
          <div className="grid grid-cols-3 gap-3">
            {ORDER_STATUSES.map((status) => (
              <Link
                key={status}
                to="/orders"
                search={{ status }}
                className="flex flex-col gap-1 rounded-lg border border-gray-100 p-3 hover:border-brand-500"
              >
                <OrderStatusBadge status={status} />
                <span className="text-2xl font-bold text-gray-900">
                  {dashboard.orderCounts[status as keyof Dashboard['orderCounts']]}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 热销商品榜 */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">近 30 天热销 Top 5</h2>
          {dashboard.topProducts.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">暂无销售数据</p>
          ) : (
            <ol className="flex flex-col divide-y divide-gray-100">
              {dashboard.topProducts.map((item, i) => (
                <li key={item.productName} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                    {item.productName}
                  </span>
                  <span className="text-sm text-gray-500">销量 {item.quantity}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* 低库存预警清单 */}
      {dashboard.lowStock.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-red-700">{LOW_STOCK_TEXT}</h2>
          <div className="flex flex-col divide-y divide-red-100">
            {dashboard.lowStock.map((item) => (
              <Link
                key={item.skuId}
                to="/products/$id"
                params={{ id: item.productId }}
                className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-red-100/60"
              >
                <span className="min-w-0 truncate text-gray-800">
                  {item.productName} · {item.skuName}
                </span>
                <span className="shrink-0 font-medium text-red-600">
                  剩 {item.stock} 件，点击补货
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

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

function KpiCard({
  label,
  value,
  sub,
  alert,
}: {
  label: string
  value: string
  sub?: string
  alert?: boolean
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        alert ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${alert ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}
