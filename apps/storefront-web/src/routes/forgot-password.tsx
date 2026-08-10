import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../libs/api/client'

export const Route = createFileRoute('/forgot-password')({
  staticData: { title: '找回密码', showBack: true },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.auth['forgot-password'].post({ email })
    setSubmitting(false)
    if (res.error) {
      setError('发送失败，请稍后重试')
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-gray-900">重置邮件已发送</h2>
        <p className="text-sm text-gray-500">
          如果该邮箱已注册，你将收到一封包含重置链接的邮件（链接 1 小时内有效）。
        </p>
        <Link
          to="/login"
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm text-white hover:bg-brand-700"
        >
          返回登录
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-4 py-6">
      <p className="text-sm text-gray-500">输入注册邮箱，我们将发送密码重置链接。</p>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">邮箱</span>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
        {submitting ? '发送中…' : '发送重置邮件'}
      </button>
      <p className="text-center text-sm text-gray-500">
        想起密码了？
        <Link to="/login" className="ml-1 text-brand-600 hover:underline">
          去登录
        </Link>
      </p>
    </form>
  )
}
