import { createFileRoute, Link } from '@tanstack/react-router'
import * as v from 'valibot'
import { useState } from 'react'

import { api } from '../libs/api/client'

const ResetSearchSchema = v.object({
  token: v.optional(v.string()),
})

export const Route = createFileRoute('/reset-password')({
  staticData: { title: '重置密码', showBack: true },
  validateSearch: ResetSearchSchema,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError('缺少重置令牌，请从邮件中的链接进入')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    const res = await api.auth['reset-password'].post({ token, password })
    setSubmitting(false)
    if (res.error) {
      const code = 'error' in res.error.value ? res.error.value.error : undefined
      setError(
        code === 'RESET_TOKEN_EXPIRED' ? '重置链接已过期，请重新申请' : '重置链接无效或已被使用',
      )
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-gray-900">密码已重置</h2>
        <Link
          to="/login"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          去登录
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-4 py-6">
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">新密码（至少 8 位）</span>
        <input
          id="password"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">确认新密码</span>
        <input
          id="confirm"
          type="password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? '提交中…' : '重置密码'}
      </button>
    </form>
  )
}
