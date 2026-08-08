import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/orders')({
  staticData: { title: '我的订单', showBack: true },
  component: () => <Placeholder title="我的订单" />,
})
