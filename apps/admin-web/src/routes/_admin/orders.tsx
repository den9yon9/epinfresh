import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/orders')({
  component: () => <div className="text-gray-400">订单 — 开发中</div>,
})
