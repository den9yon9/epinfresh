import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/')({
  component: () => <div className="text-gray-400">仪表盘 — 开发中</div>,
})
