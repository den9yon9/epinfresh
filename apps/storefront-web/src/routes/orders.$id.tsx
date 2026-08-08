import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/orders/$id')({
  staticData: { title: '订单详情', showBack: true },
  component: () => <Placeholder title="订单详情" />,
})
