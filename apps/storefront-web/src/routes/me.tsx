import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../libs/api/client'
import { getSession, logout, refreshSession, useSession } from '../libs/api/session'
import type { AuthUser } from '../libs/api/types'

export const Route = createFileRoute('/me')({
  beforeLoad: async () => {
    let user = getSession()
    if (user === undefined) user = await refreshSession()
    if (user === null) throw redirect({ to: '/login' })
  },
  component: MePage,
})

const ENTRIES = [
  { to: '/orders' as const, label: '我的订单', desc: '查看订单与物流状态' },
  { to: '/addresses' as const, label: '收货地址', desc: '管理常用收货地址' },
]

function MePage() {
  const router = useRouter()
  const session = useSession()
  const [editing, setEditing] = useState(false)

  if (session === undefined) {
    return <div className="py-20 text-center text-gray-400">加载中…</div>
  }
  // beforeLoad 已拦截未登录, 此处 null 只可能是竞态兜底
  if (session === null) {
    return <div className="py-20 text-center text-gray-400">加载中…</div>
  }
  const user = session

  return (
    <div className="flex flex-col gap-4 pb-8">
      <section className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-700">
          {(user.name ?? user.email).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{user.name ?? '未设置昵称'}</p>
          <p className="truncate text-sm text-gray-500">{user.email}</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            编辑资料
          </button>
        )}
      </section>

      {editing ? (
        <ProfileForm user={user} onDone={() => setEditing(false)} />
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">手机号</span>
            <span className="text-gray-900">{user.phone ?? '未设置'}</span>
          </div>
          <div className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">角色</span>
            <span className="text-gray-900">{user.role === 'admin' ? '管理员' : '普通用户'}</span>
          </div>
          <div className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">注册时间</span>
            <span className="text-gray-900">{new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {ENTRIES.map((entry, i) => (
          <Link
            key={entry.to}
            to={entry.to}
            className={`flex items-center justify-between px-4 py-3 ${
              i > 0 ? 'border-t border-gray-100' : ''
            }`}
          >
            <span>
              <span className="block text-sm font-medium text-gray-900">{entry.label}</span>
              <span className="block text-xs text-gray-400">{entry.desc}</span>
            </span>
            <span className="text-gray-300">›</span>
          </Link>
        ))}
      </section>

      <button
        onClick={() => void logout().then(() => router.navigate({ to: '/' }))}
        className="rounded-xl border border-gray-200 bg-white py-3 text-sm text-red-600 shadow-sm hover:bg-red-50"
      >
        退出登录
      </button>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none'

function ProfileForm({ user, onDone }: { user: AuthUser; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState(user.name ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [avatar, setAvatar] = useState(user.avatar ?? '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.auth.me.patch({
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(avatar ? { avatar } : {}),
    })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '保存失败')
      return
    }
    await refreshSession()
    onDone()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">姓名</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">手机号</span>
        <input
          type="tel"
          inputMode="numeric"
          pattern="1[3-9]\d{9}"
          title="请输入 11 位手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">头像地址</span>
        <input
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="可选，填写图片 URL"
          className={inputCls}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-gray-200 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
        >
          取消
        </button>
      </div>
    </form>
  )
}
