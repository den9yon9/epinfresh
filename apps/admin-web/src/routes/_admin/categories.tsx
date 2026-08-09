import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/categories')({
  component: () => <div className="text-gray-400">分类 — 开发中</div>,
})
