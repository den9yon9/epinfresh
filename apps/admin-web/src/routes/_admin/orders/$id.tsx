import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { OrderStatusBadge } from '../../../components/OrderStatusBadge'
import { api } from '../../../libs/api/client'
import type { Payment } from '../../../libs/api/types'

export const Route = createFileRoute('/_admin/orders/$id')({
  loader: async ({ params }) => {
    const [detailRes, paymentsRes] = await Promise.all([
      api.admin.orders({ id: params.id }).get(),
      api.admin.orders({ id: params.id }).payments.get(),
    ])
    if (detailRes.error) throw detailRes.error
    if (paymentsRes.error) throw paymentsRes.error
    return { order: detailRes.data, payments: paymentsRes.data.items }
  },
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const { order, payments } = Route.useLoaderData()
  const [error, setError] = useState<string | null>(null)

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
        <button onClick={() => setError(null)} className="ml-4 underline">
          关闭
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">订单详情</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <OrderActions status={order.status} onError={setError} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="基本信息">
          <Row label="订单号" value={shortId(order.id)} />
          <Row label="金额" value={`¥${order.totalAmount} ${order.currency}`} />
          <Row label="下单时间" value={new Date(order.createdAt).toLocaleString()} />
          {order.shippedAt && (
            <Row label="发货时间" value={new Date(order.shippedAt).toLocaleString()} />
          )}
          {order.trackingNumber && <Row label="运单号" value={order.trackingNumber} />}
        </InfoCard>
        <InfoCard title="收货信息">
          <Row label="收件人" value={`${order.recipientName} ${order.recipientPhone}`} />
          <Row label="地址" value={order.shippingAddress} />
        </InfoCard>
      </div>

      <InfoCard title={`商品明细（${order.items.length}）`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-2 py-2 font-medium">商品</th>
              <th className="px-2 py-2 font-medium">规格</th>
              <th className="px-2 py-2 font-medium">单价</th>
              <th className="px-2 py-2 font-medium">数量</th>
              <th className="px-2 py-2 font-medium">小计</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 last:border-0">
                <td className="px-2 py-2">{item.productName}</td>
                <td className="px-2 py-2 text-gray-500">{item.skuName}</td>
                <td className="px-2 py-2">¥{item.unitPrice}</td>
                <td className="px-2 py-2">{item.quantity}</td>
                <td className="px-2 py-2">¥{item.subtotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </InfoCard>

      <InfoCard title={`支付记录（${payments.length}）`}>
        {payments.length === 0 ? (
          <p className="py-4 text-center text-gray-400">暂无支付记录</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-2 py-2 font-medium">金额</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2 font-medium">渠道</th>
                <th className="px-2 py-2 font-medium">渠道单号</th>
                <th className="px-2 py-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: Payment) => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-2">¥{p.amount}</td>
                  <td className="px-2 py-2">
                    <PaymentStatusBadge status={p.status} />
                  </td>
                  <td className="px-2 py-2">{p.provider}</td>
                  <td className="px-2 py-2 text-gray-500">{p.providerRef ?? '-'}</td>
                  <td className="px-2 py-2 text-gray-500">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </InfoCard>
    </div>
  )
}

function OrderActions({ status, onError }: { status: string; onError: (msg: string) => void }) {
  const router = useRouter()
  const params = Route.useParams()
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<{ error: { value: { message?: string } } | null }>) {
    setBusy(true)
    const res = await action()
    setBusy(false)
    if (res.error) {
      onError(res.error.value.message ?? '操作失败')
      return
    }
    router.invalidate()
  }

  const patch = (s: 'cancelled' | 'completed') =>
    run(() =>
      // ponytail: body 类型坍缩为 never, 与 admin-api 测试同款 workaround; 后端按 schema 校验
      api.admin.orders({ id: params.id }).status.patch({ status: s } as never),
    )

  return (
    <div className="flex gap-2">
      {status === 'pending' && (
        <ActionButton
          disabled={busy}
          variant="danger"
          onClick={() => window.confirm('确认取消该订单？库存将回滚') && patch('cancelled')}
        >
          取消订单
        </ActionButton>
      )}
      {status === 'paid' && (
        <>
          <ShipButton onDone={() => router.invalidate()} onError={onError} />
          <ActionButton
            disabled={busy}
            variant="danger"
            onClick={() =>
              window.confirm('确认退款？') &&
              run(() => api.admin.orders({ id: params.id }).refund.post())
            }
          >
            退款
          </ActionButton>
          <ActionButton
            disabled={busy}
            variant="danger"
            onClick={() => window.confirm('确认取消该订单？库存将回滚') && patch('cancelled')}
          >
            取消订单
          </ActionButton>
        </>
      )}
      {status === 'shipped' && (
        <ActionButton disabled={busy} variant="primary" onClick={() => patch('completed')}>
          标记完成
        </ActionButton>
      )}
    </div>
  )
}

function ShipButton({ onDone, onError }: { onDone: () => void; onError: (msg: string) => void }) {
  const params = Route.useParams()
  const [open, setOpen] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [busy, setBusy] = useState(false)

  async function ship() {
    setBusy(true)
    const res = await api.admin.orders({ id: params.id }).ship.post({
      ...(trackingNumber ? { trackingNumber } : {}),
    })
    setBusy(false)
    if (res.error) {
      onError(res.error.value.message ?? '发货失败')
      return
    }
    setOpen(false)
    onDone()
  }

  return (
    <>
      <ActionButton variant="primary" onClick={() => setOpen(true)}>
        发货
      </ActionButton>
      {open && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
          <div className="w-80 rounded-xl bg-white p-5 shadow-lg">
            <h3 className="mb-3 text-base font-semibold">确认发货</h3>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="运单号（可选）"
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <ActionButton variant="ghost" onClick={() => setOpen(false)}>
                取消
              </ActionButton>
              <ActionButton variant="primary" disabled={busy} onClick={ship}>
                {busy ? '发货中…' : '确认发货'}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-20 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'border border-gray-300 text-gray-600 hover:bg-gray-100',
  }[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}

function PaymentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    succeeded: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-600',
    refunded: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  const labels: Record<string, string> = {
    pending: '待支付',
    succeeded: '已支付',
    failed: '失败',
    refunded: '已退款',
    cancelled: '已取消',
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
