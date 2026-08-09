import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
  const page = search.page ?? 1

  const goPage = (next: number) =>
    navigate({ to: '/users', search: () => ({ page: next }), replace: true })

  const totalPages = Math.max(1, Math.ceil(users.total / users.pageSize))

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
                <th className="px-4 py-3 font-medium">注册时间</th>
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
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(user.createdAt).toLocaleString()}
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
