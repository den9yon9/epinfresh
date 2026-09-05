import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'
import { useState } from 'react'

import { api } from '../libs/api/client'
import { clearSessionCache, isUnauthorized } from '../libs/api/session'
import type { Address } from '../libs/api/types'

// 直接购买: 从商品详情页带 skuId/qty 直达结算, 不经过购物车
const BuySearchSchema = v.object({
  productId: v.optional(v.string()),
  skuId: v.optional(v.string()),
  qty: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(9999))),
  addressId: v.optional(v.string()),
})

export const Route = createFileRoute('/checkout')({
  staticData: { title: '结算', showBack: true },
  validateSearch: BuySearchSchema,
  loaderDeps: ({ search }) => ({
    productId: search.productId,
    skuId: search.skuId,
    qty: search.qty,
  }),
  loader: async ({ deps }) => {
    const directBuy = Boolean(deps.productId && deps.skuId && deps.qty)
    const [addressesRes, directRes, feeRes] = await Promise.all([
      api.addresses.get(),
      directBuy ? api.products({ id: deps.productId! }).get() : Promise.resolve(null),
      api.orders['shipping-fee'].get(),
    ])
    if (isUnauthorized(addressesRes.error) || isUnauthorized(directRes?.error)) {
      clearSessionCache()
      throw redirect({ to: '/login', search: { redirectTo: '/checkout' } })
    }
    if (addressesRes.error || directRes?.error) {
      throw new Error('结算信息加载失败，请稍后重试')
    }
    // 运费配置拉取失败不阻塞结算: 前端仅做预览, 服务端下单时才是权威计算
    if (isUnauthorized(feeRes.error)) {
      clearSessionCache()
      throw redirect({ to: '/login', search: { redirectTo: '/checkout' } })
    }
    const feeConfig = feeRes.error ? null : feeRes.data

    type CheckoutItem = {
      skuId: string
      name: string
      productName: string
      price: number
      quantity: number
      image?: string
    }
    let cart: { items: CheckoutItem[] }
    if (directBuy) {
      // 直接购买: 从产品详情里筛出目标 SKU, 构造与购物车同构的条目
      const sku = directRes?.data.skus.find((s) => s.id === deps.skuId)
      if (!sku || !directRes) throw new Error('商品不存在，请重新选择')
      cart = {
        items: [
          {
            skuId: sku.id,
            name: sku.name,
            productName: directRes.data.name,
            price: Number(sku.price),
            quantity: deps.qty!,
            image: directRes.data.images[0],
          },
        ],
      }
    } else {
      // 购物车结算
      const cartRes = await api.cart.get()
      if (isUnauthorized(cartRes.error)) {
        clearSessionCache()
        throw redirect({ to: '/login', search: { redirectTo: '/checkout' } })
      }
      if (cartRes.error) throw new Error('结算信息加载失败，请稍后重试')
      cart = {
        items: cartRes.data.items.map((item) => ({
          skuId: item.sku.id,
          name: item.sku.name,
          productName: item.product.name,
          price: Number(item.sku.price),
          quantity: item.quantity,
          image: item.product.images[0],
        })),
      }
    }

    return { cart, addresses: addressesRes.data.items, feeConfig }
  },
  component: CheckoutPage,
})

function CheckoutPage() {
  const { cart, addresses, feeConfig } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const defaultAddr = addresses.find((a) => a.isDefault)
  // addressId 写入 search: 去管理地址再返回时保留选择; search 里的地址已被删则回退默认
  const [addressId, setAddressId] = useState<string | undefined>(
    search.addressId && addresses.some((a) => a.id === search.addressId)
      ? search.addressId
      : defaultAddr?.id,
  )
  const [error, setError] = useState<string | null>(null)
  const [stockError, setStockError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 幂等键: 每次进入结算页生成一次, 防双提交/重试产生重复订单。
  // 生命周期 = 一次提交尝试: 提交完结后重生成(见 submit 内注释), 页面停留期间改内容再提交不会被静默去重
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const directBuy = Boolean(search.productId && search.skuId && search.qty)

  function selectAddress(id: string) {
    setAddressId(id)
    void navigate({
      to: '/checkout',
      search: (prev) => ({ ...prev, addressId: id }),
      replace: true,
    })
  }

  const goodsTotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  // 运费预览(与服务端 computeShippingFee 同规则): 满额包邮(非偏远) + 偏远加价 + 首重/续重。
  // 购物车视图不含克重字段, 续重部分按每件默认 500g 估算总重, 以下单时服务端计算为准。
  const selectedAddress = addresses.find((a) => a.id === addressId)
  const feeActive =
    feeConfig !== null &&
    (Number(feeConfig.flatFee) > 0 ||
      feeConfig.freeShippingThreshold !== null ||
      feeConfig.remoteProvinces.length > 0 ||
      Number(feeConfig.weightAdditionalFee) > 0)
  let shippingFee = 0
  if (feeActive) {
    const isRemote = feeConfig!.remoteProvinces.includes(selectedAddress?.province ?? '')
    const threshold = feeConfig!.freeShippingThreshold
    if (!isRemote && threshold !== null && goodsTotal >= Number(threshold)) {
      shippingFee = 0
    } else {
      const baseFee = isRemote ? Number(feeConfig!.remoteFee) : Number(feeConfig!.flatFee)
      const estWeight = cart.items.reduce((sum, item) => sum + 500 * item.quantity, 0)
      const excess = Math.max(0, estWeight - feeConfig!.weightBaseGrams)
      const units = Math.ceil(excess / Math.max(1, feeConfig!.weightAdditionalGrams))
      shippingFee = baseFee + units * Number(feeConfig!.weightAdditionalFee)
    }
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
        <p>购物车是空的，先去挑点东西吧</p>
        <Link
          to="/"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          去逛逛
        </Link>
      </div>
    )
  }

  async function submit() {
    if (!addressId) return
    setError(null)
    setStockError(false)
    setSubmitting(true)
    const res = await api.orders.post(
      {
        items: cart.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
        addressId,
      },
      { headers: { 'idempotency-key': idempotencyKey } },
    )
    setSubmitting(false)
    if (res.error) {
      // 幂等键生命周期 = 一次提交尝试:
      // - 明确的 4xx 拒绝(服务端事务必然回滚、未建单) → 重生成, 下次提交是新意图
      // - 网络失败(eden 以 503 + response undefined 表示)或 5xx → 服务端结果未知,
      //   保留 key: 用户重试时后端幂等返回同一笔订单, 防止重复下单
      const status = res.error.status
      if (status >= 400 && status < 500) setIdempotencyKey(crypto.randomUUID())
      const value = res.error.value
      if ('skuId' in value) {
        const item = cart.items.find((i) => i.skuId === value.skuId)
        setStockError(true)
        setError(
          `${item ? `「${item.productName}」` : '部分商品'}库存不足，仅剩 ${value.available} 件，请返回调整数量`,
        )
        return
      }
      const messages: Record<string, string> = {
        SKU_NOT_FOUND: '部分商品不存在，请返回重新选择',
        PRODUCT_UNAVAILABLE: '部分商品已下架，请返回重新选择',
        ADDRESS_NOT_FOUND: '收货地址无效，请重新选择',
      }
      const code = 'error' in value ? value.error : undefined
      setError((code ? messages[code] : undefined) ?? '下单失败，请稍后重试')
      return
    }
    // 提交成功: 本次尝试完结, 重生成 key——防止停留在本页改内容再提交时,
    // 同 key 不同 body 被后端按幂等静默返回旧订单
    setIdempotencyKey(crypto.randomUUID())
    // replace: 下单后购物车已清空, 从支付页返回不应回到空结算页
    navigate({ to: '/pay', search: { orderId: res.data.id }, replace: true })
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">收货地址</h2>
          <Link
            to="/addresses"
            search={{ from: 'checkout' }}
            className="text-sm text-brand-600 hover:underline"
          >
            管理地址
          </Link>
        </div>
        {addresses.length === 0 ? (
          <Link
            to="/addresses/new"
            search={{ from: 'checkout' }}
            className="block rounded-lg border border-dashed border-gray-300 py-4 text-center text-sm text-gray-400 hover:border-brand-500"
          >
            + 新增收货地址
          </Link>
        ) : (
          <div className="flex flex-col gap-2">
            {addresses.map((addr: Address) => (
              <label
                key={addr.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  addressId === addr.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={addressId === addr.id}
                  onChange={() => selectAddress(addr.id)}
                  className="mt-1 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{addr.recipientName}</span>
                    <span className="text-sm text-gray-500">{addr.phone}</span>
                    {addr.isDefault && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                        默认
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-gray-600">
                    {addr.province}
                    {addr.city}
                    {addr.district}
                    {addr.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">商品清单</h2>
        <div className="flex flex-col gap-3">
          {cart.items.map((item) => (
            <div key={item.skuId} className="flex items-center gap-3">
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.productName}
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-gray-100" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{item.productName}</p>
                <p className="text-xs text-gray-500">
                  {item.name} × {item.quantity}
                </p>
              </div>
              <span className="text-sm text-gray-900">
                ¥{(item.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-600">{error}</p>
          {stockError && (
            <Link
              to={directBuy ? '/products/$id' : '/cart'}
              params={directBuy ? { id: search.productId! } : undefined}
              className="rounded-lg border border-brand-600 px-4 py-2 text-center text-sm text-brand-600 hover:bg-brand-50"
            >
              {directBuy ? '返回商品页调整' : '返回购物车调整'}
            </Link>
          )}
        </div>
      )}
      {!addressId && (
        <p className="text-sm text-gray-500">
          {addresses.length === 0 ? '请先添加收货地址' : '请选择收货地址后再提交订单'}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="text-sm text-gray-500">
            {feeActive && (
              <p className="text-xs">
                商品 ¥{goodsTotal.toFixed(2)} · 运费{' '}
                {shippingFee === 0 ? (
                  <span className="text-brand-600">免运费</span>
                ) : (
                  `¥${shippingFee.toFixed(2)}`
                )}
              </p>
            )}
            <p>
              合计{' '}
              <span className="text-lg font-bold text-gray-900">
                ¥{(goodsTotal + shippingFee).toFixed(2)}
              </span>
            </p>
          </div>
          <button
            onClick={submit}
            disabled={!addressId || submitting}
            className="rounded-lg bg-brand-600 px-8 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      </div>
    </div>
  )
}
