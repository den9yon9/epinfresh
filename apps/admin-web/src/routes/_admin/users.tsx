import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import * as v from 'valibot'

import { api } from '../../libs/api/client'

const PAGE_SIZE = 20

const UsersSearchSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
})

export const Route = createFileRoute('/_admin/users')({
  validateSearch: UsersSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const res = await api.admin.users.get({ query: { page: deps.page, pageSize: PAGE_SIZE } })
    if (res.error) throw res.error
    return { users: res.data }
  },
  component: UsersPage,
})

function UsersPage() {
  const { users } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const page = search.page ?? 1

  const goPage = (next: number) =>
    navigate({ to: '/users', search: () => ({ page: next }), replace: true })

  const totalPages = Math.max(1, Math.ceil(users.total / users.pageSize))

  const update = async (
    user: (typeof users.items)[number],
    body: { role?: 'customer' | 'admin'; isActive?: boolean },
    confirmText: string,
  ) => {
    if (!window.confirm(confirmText)) return
    // ponytail: eden 子路径 patch 的 body 类型坍缩, 与订单 status.patch 同款 workaround
    const res = await api.admin.users({ id: user.id }).patch({ ...body } as never)
    if (res.error) {
      window.alert((res.error.value as { message?: string }).message ?? '操作失败')
      return
    }
    router.invalidate()
  }

  const toggleRole = (user: (typeof users.items)[number]) =>
    update(
      user,
      { role: user.role === 'admin' ? 'customer' : 'admin' },
      `确定将 ${user.email} 的角色改为 ${user.role === 'admin' ? '客户' : '管理员'}？`,
    )

  const toggleActive = (user: (typeof users.items)[number]) =>
    update(
      user,
      { isActive: !user.isActive },
      user.isActive
        ? `确定禁用 ${user.email}？禁用后其账号无法登录，现有会话立即失效。`
        : `确定启用 ${user.email}？`,
    )

  return (
    <div className="flex flex-col gap-4">
      {users.items.length === 0 ? (
        <p className="py-16 text-center text-gray-400">暂无用户</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">电话</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.items.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.name ?? '-'}</td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3 text-gray-500">{user.phone ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        user.role === 'admin'
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {user.role === 'admin' ? '管理员' : '客户'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {user.isActive ? '正常' : '已禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(user.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleRole(user)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        {user.role === 'admin' ? '降为客户' : '设为管理员'}
                      </button>
                      <button
                        onClick={() => toggleActive(user)}
                        className={`rounded border px-2 py-1 text-xs ${
                          user.isActive
                            ? 'border-red-200 text-red-600 hover:bg-red-50'
                            : 'border-green-200 text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {user.isActive ? '禁用' : '启用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 py-2">
        <button
          onClick={() => goPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          上一页
        </button>
        <span className="text-sm text-gray-500">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}
