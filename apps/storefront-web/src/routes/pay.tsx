import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import * as v from 'valibot'
import { useEffect, useState } from 'react'

import { PaymentQrCode } from '../components/PaymentQrCode'
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

// 二维码展示期间轮询订单状态, 渠道回调确认成功后前端自动翻页
const PAYMENT_POLL_INTERVAL_MS = 3000

// 支付渠道由构建环境决定(VITE_PAYMENT_CHANNEL): mock=开发/联调走本地确认, wechat=真实/模拟器回调
const PAYMENT_CHANNEL: 'mock' | 'wechat' = import.meta.env.VITE_PAYMENT_CHANNEL ?? 'mock'

// 与网关契约的 PaymentPayload 保持一致; 前端按 type 分支渲染
type PayPayload =
  | { type: 'qr'; codeUrl: string }
  | { type: 'redirect'; url: string }
  | { type: 'params'; params: Record<string, string> }

function PayPage() {
  const order = Route.useLoaderData()
  const { orderId } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 订单状态随轮询实时更新, 不再依赖 loader 初始快照
  const [status, setStatus] = useState(order.status)
  const paid = PAID_STATUSES.has(status)
  const [pending, setPending] = useState<{
    paymentId: string
    provider: string
    payload: PayPayload
  } | null>(null)

  // 发起支付后轮询订单状态: 支付成功/取消/退款都能即时反映到页面
  useEffect(() => {
    if (pending === null || status !== 'pending') return
    const timer = setInterval(async () => {
      const res = await api.orders({ id: orderId }).get()
      if (isUnauthorized(res.error)) {
        clearSessionCache()
        window.location.assign(`/login?redirectTo=${encodeURIComponent(`/pay?orderId=${orderId}`)}`)
        return
      }
      if (res.error) return // 瞬时失败, 下一轮重试
      setStatus(res.data.status)
    }, PAYMENT_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [pending, status, orderId])

  async function pay() {
    setError(null)
    setBusy(true)
    // 渠道由 VITE_PAYMENT_CHANNEL 决定; 前端不做渠道选择
    const initiated = await api.orders({ id: orderId }).pay.post({ channel: PAYMENT_CHANNEL })
    if (initiated.error) {
      setBusy(false)
      const code = 'error' in initiated.error.value ? initiated.error.value.error : undefined
      setError(
        code === 'ORDER_NOT_PENDING' || code === 'PAYMENT_CHANNEL_NOT_CONFIGURED'
          ? '订单已支付或状态已变化'
          : '支付失败，请稍后重试',
      )
      return
    }
    const { payment, payload } = initiated.data
    // redirect: 直接跳转渠道支付页 (真实 H5; mock 不返回该类型)
    if (payload.type === 'redirect') {
      window.location.assign(payload.url)
      return
    }
    setPending({ paymentId: payment.id, provider: payment.provider, payload })
    setBusy(false)
  }

  async function confirmMock() {
    if (!pending) return
    setError(null)
    setBusy(true)
    const confirmed = await api.payments({ id: pending.paymentId }).confirm.post()
    setBusy(false)
    if (confirmed.error) {
      setError('支付确认失败，请刷新后重试')
      return
    }
    setStatus('paid')
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
          replace
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          查看订单
        </Link>
      </div>
    )
  }

  if (status !== 'pending') {
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
          {labels[status] ?? '订单状态已变化'}
        </h2>
        <Link
          to="/orders/$id"
          params={{ id: order.id }}
          replace
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          查看订单
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <OrderInfo order={order} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pending === null ? (
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
      ) : pending.payload.type === 'qr' ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">扫码支付</h2>
          <PaymentQrCode codeUrl={pending.payload.codeUrl} />
          <p className="text-sm text-gray-500">请使用微信或支付宝扫码完成支付</p>
          {pending.provider === 'mock' && (
            <button
              onClick={confirmMock}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? '处理中…' : '模拟支付完成'}
            </button>
          )}
        </section>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">请在微信内完成支付</h2>
          <p className="text-sm text-gray-500">支付请求已发出，请在微信中确认</p>
        </section>
      )}
    </div>
  )
}

function OrderInfo({
  order,
}: {
  order: { id: string; totalAmount: string; items: Array<{ quantity: number }> }
}) {
  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0)
  return (
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
  )
}
