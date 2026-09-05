import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { addressLineText } from '../../components/AddressForm'
import { Toast } from '../../components/Toast'
import { api } from '../../libs/api/client'
import { clearSessionCache, isUnauthorized } from '../../libs/api/session'

export const Route = createFileRoute('/addresses/')({
  staticData: { title: '地址管理', showBack: true },
  loader: async () => {
    const res = await api.addresses.get()
    if (isUnauthorized(res.error)) {
      clearSessionCache()
      throw redirect({ to: '/login', search: { redirectTo: '/addresses' } })
    }
    if (res.error) {
      throw new Error('地址加载失败，请稍后重试')
    }
    return res.data.items
  },
  component: AddressesPage,
})

function AddressesPage() {
  const addresses = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function flash(msg: string) {
    setNotice(msg)
  }

  async function setDefault(id: string) {
    setBusyId(id)
    const res = await api.addresses({ id }).put({ isDefault: true })
    setBusyId(null)
    if (res.error) {
      flash('设置失败，请稍后重试')
      return
    }
    router.invalidate()
  }

  async function remove(id: string) {
    if (!window.confirm('确认删除该地址？')) return
    setBusyId(id)
    const res = await api.addresses({ id }).delete()
    setBusyId(null)
    if (res.error) {
      flash('删除失败，请稍后重试')
      return
    }
    router.invalidate()
  }

  if (addresses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
        <p>还没有收货地址</p>
        <Link
          to="/addresses/new"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          新增地址
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      {addresses.map((addr) => (
        <div key={addr.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{addr.recipientName}</span>
              {addr.isDefault && (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                  默认
                </span>
              )}
            </div>
            <span className="text-sm text-gray-500">{addr.phone}</span>
          </div>
          <p className="text-sm text-gray-600">{addressLineText(addr)}</p>
          <div className="mt-3 flex gap-4 text-sm">
            <Link
              to="/addresses/$id/edit"
              params={{ id: addr.id }}
              className="text-gray-500 hover:underline"
            >
              编辑
            </Link>
            {!addr.isDefault && (
              <button
                onClick={() => setDefault(addr.id)}
                disabled={busyId === addr.id}
                className="text-gray-500 hover:underline disabled:opacity-40"
              >
                设默认
              </button>
            )}
            <button
              onClick={() => remove(addr.id)}
              disabled={busyId === addr.id}
              className="text-red-500 hover:underline disabled:opacity-40"
            >
              删除
            </button>
          </div>
        </div>
      ))}

      {notice && <Toast message={notice} onDismiss={() => setNotice(null)} />}

      <button
        onClick={() => navigate({ to: '/addresses/new' })}
        className="fixed inset-x-4 bottom-4 z-10 mx-auto max-w-6xl rounded-lg bg-brand-600 py-2.5 text-white hover:bg-brand-700"
      >
        新增地址
      </button>
    </div>
  )
}
