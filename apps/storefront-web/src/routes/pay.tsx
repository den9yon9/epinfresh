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
// 自动轮询上限: 5 分钟未支付则停止轮询, 仅保留提示, 避免无限空转
const PAYMENT_POLL_TIMEOUT_MS = 5 * 60 * 1000

// 支付渠道: 由构建环境 VITE_PAYMENT_CHANNEL 决定(逗号分隔多值, 默认 mock);
// 结合运行环境(微信/支付宝内置浏览器)过滤: 微信内不展示支付宝, 支付宝内不展示微信
type PaymentChannel = 'mock' | 'wechat' | 'alipay'

const CHANNEL_LABELS: Record<PaymentChannel, string> = {
  mock: '模拟支付',
  wechat: '微信支付',
  alipay: '支付宝',
}

function parseChannels(raw: string | undefined): PaymentChannel[] {
  const configured = (raw ?? 'mock')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PaymentChannel => s === 'mock' || s === 'wechat' || s === 'alipay')
  return configured.length > 0 ? configured : ['mock']
}

function isInWeChatBrowser(ua = navigator.userAgent): boolean {
  return /MicroMessenger/i.test(ua)
}

function isInAlipayBrowser(ua = navigator.userAgent): boolean {
  return /AlipayClient/i.test(ua)
}

// 运行环境渠道过滤: 微信内置浏览器只保留微信, 支付宝内置浏览器只保留支付宝
function filterByEnvironment(channels: PaymentChannel[]): PaymentChannel[] {
  if (isInWeChatBrowser()) return channels.filter((c) => c === 'wechat')
  if (isInAlipayBrowser()) return channels.filter((c) => c === 'alipay')
  return channels
}

const PAYMENT_CHANNELS = filterByEnvironment(parseChannels(import.meta.env.VITE_PAYMENT_CHANNEL))

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
  const [pollStopped, setPollStopped] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannel | null>(
    PAYMENT_CHANNELS[0] ?? null,
  )
  // 环境过滤后无可用渠道(如支付宝内配置只有微信)时的提示
  const noAvailableChannel = PAYMENT_CHANNELS.length === 0

  // 单次刷新订单状态(轮询/「我已支付」按钮共用)
  async function refreshStatus(): Promise<void> {
    const res = await api.orders({ id: orderId }).get()
    if (isUnauthorized(res.error)) {
      clearSessionCache()
      window.location.assign(`/login?redirectTo=${encodeURIComponent(`/pay?orderId=${orderId}`)}`)
      return
    }
    if (res.error) return // 瞬时失败, 下一轮重试
    setStatus(res.data.status)
  }

  // 发起支付后轮询订单状态: 支付成功/取消/退款都能即时反映到页面
  useEffect(() => {
    if (pending === null || status !== 'pending' || pollStopped) return
    const deadline = Date.now() + PAYMENT_POLL_TIMEOUT_MS
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(timer)
        setPollStopped(true)
        return
      }
      await refreshStatus()
    }, PAYMENT_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [pending, status, orderId, pollStopped])

  async function pay() {
    if (!selectedChannel) return
    setError(null)
    setBusy(true)
    // 渠道由用户选择(VITE_PAYMENT_CHANNEL 提供候选 + 环境过滤)
    const initiated = await api.orders({ id: orderId }).pay.post({ channel: selectedChannel })
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
            {noAvailableChannel ? (
              <p className="text-sm text-gray-400">当前环境暂不支持在线支付</p>
            ) : (
              <div className="flex items-center gap-3">
                {PAYMENT_CHANNELS.length > 1 && (
                  <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
                    {PAYMENT_CHANNELS.map((channel) => (
                      <button
                        key={channel}
                        onClick={() => setSelectedChannel(channel)}
                        className={`px-3 py-2 ${
                          selectedChannel === channel
                            ? 'bg-brand-600 text-white'
                            : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {CHANNEL_LABELS[channel]}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={pay}
                  disabled={busy || !selectedChannel}
                  className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? '支付中…' : '确认支付'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : pending.payload.type === 'qr' ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">扫码支付</h2>
          <PaymentQrCode codeUrl={pending.payload.codeUrl} />
          <p className="text-sm text-gray-500">
            {pending.provider === 'wechat'
              ? '请使用微信扫码完成支付'
              : pending.provider === 'alipay'
                ? '请使用支付宝扫码完成支付'
                : '请使用微信或支付宝扫码完成支付'}
          </p>
          {pollStopped && (
            <p className="text-sm text-amber-600">自动轮询已停止；已支付请点下方按钮刷新结果</p>
          )}
          {pending.provider === 'mock' && (
            <button
              onClick={confirmMock}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? '处理中…' : '模拟支付完成'}
            </button>
          )}
          {pending.provider !== 'mock' && (
            <button
              onClick={() => void refreshStatus()}
              className="rounded-lg border border-brand-600 px-8 py-2.5 text-brand-600 hover:bg-brand-50"
            >
              我已支付，刷新
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
