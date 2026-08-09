import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../libs/api/client'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.auth.login.post({ email, password })
    setSubmitting(false)
    if (res.error !== null) {
      setError(res.error.value.message ?? '登录失败')
      return
    }
    router.navigate({ to: '/' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="mb-6 text-xl font-bold text-gray-900">一品鲜管理后台</h1>
        <label htmlFor="email" className="mb-1 block text-sm text-gray-600">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
        <label htmlFor="password" className="mb-1 block text-sm text-gray-600">
          密码
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
