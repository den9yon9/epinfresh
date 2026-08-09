import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'

import { api } from '../libs/api/client'
import type { AdminUser } from '../libs/api/types'

export interface AdminContext {
  adminUser: AdminUser
}

async function fetchAdminUser(): Promise<AdminUser | null> {
  const res = await api.auth.me.get()
  return res.error === null ? res.data : null
}

export const Route = createFileRoute('/_admin')({
  beforeLoad: async (): Promise<AdminContext> => {
    const adminUser = await fetchAdminUser()
    if (!adminUser || adminUser.role !== 'admin') {
      throw redirect({ to: '/login' })
    }
    return { adminUser }
  },
  component: AdminLayout,
})

const NAV_ITEMS = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/orders', label: '订单', end: false },
  { to: '/products', label: '商品', end: false },
  { to: '/categories', label: '分类', end: false },
  { to: '/users', label: '用户', end: false },
]

function AdminLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-44 shrink-0 border-r border-gray-200 bg-white">
        <div className="px-4 py-4 text-lg font-bold text-brand-700">一品鲜</div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.end }}
              className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              activeProps={{ className: 'bg-brand-50 font-semibold text-brand-700' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
          <h1 className="text-base font-semibold text-gray-900">管理后台</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {Route.useRouteContext().adminUser.name ?? Route.useRouteContext().adminUser.email}
            </span>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function LogoutButton() {
  const navigate = useNavigate()
  return (
    <button
      onClick={async () => {
        await api.auth.logout.post()
        navigate({ to: '/login' })
      }}
      className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
    >
      退出
    </button>
  )
}
