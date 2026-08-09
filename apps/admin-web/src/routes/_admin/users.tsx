import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/users')({
  component: () => <div className="text-gray-400">用户 — 开发中</div>,
})
