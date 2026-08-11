import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'
import { useState } from 'react'

import { login } from '../libs/api/session'

const LoginSearchSchema = v.object({
  redirectTo: v.optional(v.string()),
})

export const Route = createFileRoute('/login')({
  staticData: { title: '登录', showBack: true },
  validateSearch: LoginSearchSchema,
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { redirectTo } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { user, error } = await login(email, password)
    setSubmitting(false)
    if (!user) {
      setError(error === 'ACCOUNT_DISABLED' ? '该账号已被禁用，请联系管理员' : '邮箱或密码错误')
      return
    }
    // replace: 登录页从历史栈移除, 返回键不会回到登录页
    if (redirectTo && redirectTo.startsWith('/')) navigate({ to: redirectTo, replace: true })
    else navigate({ to: '/', replace: true })
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-4 py-6">
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
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">密码</span>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {submitting ? '登录中…' : '登录'}
      </button>
      <p className="text-right text-sm">
        <Link to="/forgot-password" className="text-brand-600 hover:underline">
          忘记密码？
        </Link>
      </p>
      <p className="text-center text-sm text-gray-500">
        还没有账号？
        <Link
          to="/register"
          search={redirectTo ? { redirectTo } : undefined}
          className="ml-1 text-brand-600 hover:underline"
        >
          去注册
        </Link>
      </p>
    </form>
  )
}
