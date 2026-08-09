const STATUS_META: Record<string, { label: string; badge: string }> = {
  pending: { label: '待支付', badge: 'bg-amber-100 text-amber-700' },
  paid: { label: '已支付', badge: 'bg-blue-100 text-blue-700' },
  shipped: { label: '已发货', badge: 'bg-indigo-100 text-indigo-700' },
  completed: { label: '已完成', badge: 'bg-green-100 text-green-700' },
  refunded: { label: '已退款', badge: 'bg-gray-100 text-gray-600' },
  cancelled: { label: '已取消', badge: 'bg-red-100 text-red-600' },
}

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, badge: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${meta.badge}`}>
      {meta.label}
    </span>
  )
}
