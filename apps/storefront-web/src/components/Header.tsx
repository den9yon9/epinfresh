import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { logout, refreshSession, useSession } from '../libs/api/session'

// ponytail: staticData 类型太松, 读侧用窄接口断言
interface PageMeta {
  title?: string
  showBack?: boolean
}

export function Header() {
  const router = useRouter()
  const meta = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const m = s.matches[i].staticData as PageMeta | undefined
        if (m) return m
      }
      return undefined
    },
  })

  useEffect(() => {
    document.title = meta?.title ? `${meta.title} · 一品鲜` : '一品鲜'
  }, [meta?.title])

  if (meta?.showBack) {
    return (
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-gray-200 bg-white px-2 md:px-4">
        <button
          // canGoBack 由 TanStack history 的 __TSR_index 判定: 站内导航过才有站内历史可退,
          // 直达/刷新后 index 归零, 此时回首页而不是离开站点
          onClick={() => {
            if (router.history.canGoBack()) router.history.back()
            else void router.navigate({ to: '/' })
          }}
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center text-gray-600"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-base font-semibold">{meta.title}</span>
      </header>
    )
  }

  return (
    <header className="flex h-12 items-center justify-between px-4 bg-brand-600 text-white md:px-6">
      <Link to="/" className="text-xl font-bold">
        一品鲜
      </Link>
      <UserArea />
    </header>
  )
}

function UserArea() {
  const user = useSession()
  const router = useRouter()

  useEffect(() => {
    void refreshSession()
  }, [])

  if (user === undefined) return <span className="text-sm opacity-70">…</span>
  if (user === null) {
    return (
      <Link to="/login" className="text-sm hover:underline">
        登录
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link to="/me" className="max-w-28 truncate hover:underline">
        {user.name ?? user.email}
      </Link>
      <button
        onClick={() => void logout().then(() => router.navigate({ to: '/', replace: true }))}
        className="rounded border border-white/40 px-2 py-0.5 text-xs hover:bg-white/10"
      >
        退出
      </button>
    </div>
  )
}
