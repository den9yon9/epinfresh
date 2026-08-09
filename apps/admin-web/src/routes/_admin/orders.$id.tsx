import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/orders/$id')({
  component: () => <div className="text-gray-400">订单详情 — 开发中</div>,
})
