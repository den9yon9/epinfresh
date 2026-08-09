import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_admin/products')({
  component: () => <div className="text-gray-400">商品 — 开发中</div>,
})
