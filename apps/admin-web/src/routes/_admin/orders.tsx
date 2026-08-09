import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'

import { OrderStatusBadge, ORDER_STATUSES } from '../../components/OrderStatusBadge'
import { api } from '../../libs/api/client'

const PAGE_SIZE = 20

const OrdersSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  status: v.optional(v.picklist([...ORDER_STATUSES] as [string, ...string[]])),
})

export const Route = createFileRoute('/_admin/orders')({
  validateSearch: OrdersSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page, status: search.status }),
  loader: async ({ deps }) => {
    const res = await api.admin.orders.get({
      query: {
        page: deps.page,
        pageSize: PAGE_SIZE,
        ...(deps.status ? { status: deps.status } : {}),
      },
    })
    if (res.error) throw res.error
    return { orders: res.data }
  },
  component: OrdersPage,
})

function OrdersPage() {
  const { orders } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const page = search.page ?? 1

  const selectStatus = (status?: string) =>
    navigate({
      to: '/orders',
      search: () => ({ page: 1, status }),
      replace: true,
    })
  const goPage = (next: number) =>
    navigate({
      to: '/orders',
      search: () => ({ page: next, status: search.status }),
      replace: true,
    })

  const totalPages = Math.max(1, Math.ceil(orders.total / orders.pageSize))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => selectStatus(undefined)}
          className={`rounded-full px-3 py-1 text-sm ${
            search.status === undefined
              ? 'bg-brand-600 text-white'
              : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          全部
        </button>
        {ORDER_STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => selectStatus(status)}
            className={`rounded-full px-3 py-1 text-sm ${
              search.status === status
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {statusLabel(status)}
          </button>
        ))}
      </div>

      {orders.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">暂无订单</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">收件人</th>
                <th className="px-4 py-3 font-medium">金额</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">下单时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.items.map((order) => (
                <tr key={order.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">{order.recipientName}</td>
                  <td className="px-4 py-3">
                    ¥{order.totalAmount} {order.currency}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(order.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/orders/$id"
                      params={{ id: order.id }}
                      className="text-brand-600 hover:underline"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 py-2">
        <button
          onClick={() => goPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          上一页
        </button>
        <span className="text-sm text-gray-500">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '待支付',
    paid: '已支付',
    shipped: '已发货',
    completed: '已完成',
    refunded: '已退款',
    cancelled: '已取消',
  }
  return map[status] ?? status
}
