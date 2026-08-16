import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import * as v from 'valibot'
import { useState } from 'react'

import { api } from '../libs/api/client'
import { parseRedirect } from '../libs/api/redirect'
import { login } from '../libs/api/session'

const RegisterSearchSchema = v.object({
  redirectTo: v.optional(v.string()),
})

export const Route = createFileRoute('/register')({
  staticData: { title: '注册', showBack: true },
  validateSearch: RegisterSearchSchema,
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const { redirectTo } = Route.useSearch()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await api.auth.register.post({ name, email, password })
    if (res.error) {
      setSubmitting(false)
      setError(res.error.value.message ?? '注册失败')
      return
    }
    // 注册不自动建立会话, 顺手登录一次直接进入
    const { user } = await login(email, password)
    setSubmitting(false)
    if (!user) {
      navigate({ to: '/login', replace: true })
      return
    }
    // replace: 注册页从历史栈移除, 返回键不会回到注册页
    if (redirectTo && redirectTo.startsWith('/')) {
      navigate({ ...parseRedirect(redirectTo), replace: true })
    } else navigate({ to: '/', replace: true })
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-4 py-6">
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">昵称</span>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </label>
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
        <span className="mb-1 block text-sm text-gray-600">密码（至少 8 位）</span>
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? '注册中…' : '注册'}
      </button>
      <p className="text-center text-sm text-gray-500">
        已有账号？
        <Link to="/login" className="ml-1 text-brand-600 hover:underline">
          去登录
        </Link>
      </p>
    </form>
  )
}
