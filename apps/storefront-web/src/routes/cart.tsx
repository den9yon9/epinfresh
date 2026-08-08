import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/cart')({
  staticData: { title: '购物车' },
  component: () => <Placeholder title="购物车" />,
})
