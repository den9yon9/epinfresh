import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/products/$id')({
  staticData: { title: '商品详情', showBack: true },
  component: () => <Placeholder title="商品详情" />,
})
